"""Credential injection for the egress proxy (mitmproxy addon).

The client sends a fixed placeholder in place of every secret. For each intercepted request,
this addon replaces that placeholder with the real secret for the destination, chosen by the
connection's verified identity, wherever the placeholder appears. The client decides where the
secret goes, so no provider-specific knowledge is needed; real secrets stay proxy-side and the
client only ever holds the placeholder.

Inputs:
  config    which destination injects which named secret
  secrets   the real value for each named secret
  marker    the placeholder the client sends in place of a secret
"""

import os
from pathlib import Path
from urllib.parse import quote

import tomllib
from mitmproxy import http, tls

CONFDIR = "/home/mitmproxy/.mitmproxy"
CONFIG_FILE = os.environ.get("O3S_CONFIG_FILE", f"{CONFDIR}/config.toml")
SECRETS_FILE = os.environ.get("O3S_SECRETS_FILE", f"{CONFDIR}/secrets.env")


def _parse_secrets(text):
    """Parse the secrets file into a name-to-value mapping, trimming whitespace and quotes."""
    out = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, _, tok = line.partition("=")
        tok = tok.strip().strip('"').strip("'")
        if "\r" in tok or "\n" in tok:
            continue  # reject embedded CR/LF (header-injection guard)
        if tok:
            out[name.strip()] = tok
    return out


class InjectCredentials:
    """Swap the client's placeholder for the destination's real secret."""

    def __init__(self):
        self.marker = os.environ.get("O3S_MARKER", "")
        self._sig = None
        # Maps each intercepted host to its resolved secret, or None until the secret is filled in.
        self._hosts = {}
        self._load()

    def _load(self):
        """Reload config and secrets when either file changes."""
        try:
            sig = (os.stat(CONFIG_FILE).st_mtime, os.stat(SECRETS_FILE).st_mtime)
        except OSError:
            sig = None
        if sig == self._sig:
            return
        self._sig = sig
        try:
            cfg = tomllib.loads(Path(CONFIG_FILE).read_text())
            secrets = _parse_secrets(Path(SECRETS_FILE).read_text())
        except OSError:
            cfg, secrets = {}, {}
        hosts = {}
        for host, spec in cfg.items():
            name = spec.get("secret") if isinstance(spec, dict) else None
            if name:
                hosts[host] = secrets.get(name)  # None until the secret is filled in
        self._hosts = hosts

    def tls_clienthello(self, data: tls.ClientHelloData) -> None:
        """Pass connections we do not inject straight through, untouched."""
        self._load()
        if (data.client_hello.sni or "") not in self._hosts:
            data.ignore_connection = True

    def requestheaders(self, flow: http.HTTPFlow) -> None:
        """Buffer an intercepted body so the placeholder can be replaced inside it."""
        self._load()
        if (flow.client_conn.sni or "") in self._hosts:
            flow.request.stream = False

    def request(self, flow: http.HTTPFlow) -> None:
        """Replace the placeholder with the destination's secret wherever it appears."""
        self._load()
        host = flow.client_conn.sni or ""
        if host not in self._hosts:
            return
        token = self._hosts.get(host)
        if not token:
            # Fail closed: intercepted, but no usable secret, so reject rather than forward keyless.
            flow.response = http.Response.make(
                502, b"o3s: no secret configured for this host\n", {"Content-Type": "text/plain"}
            )
            return
        m = self.marker
        if not m:
            return
        req = flow.request
        # Headers: replace per unique name to preserve duplicate headers.
        for name in {k for k, _ in req.headers.items(multi=True)}:
            vals = req.headers.get_all(name)
            new = [v.replace(m, token) for v in vals]
            if new != vals:
                req.headers.set_all(name, new)
        # Query: the marker is URL-safe; percent-encode the token so it stays valid in the URL.
        if m in req.path:
            req.path = req.path.replace(m, quote(token, safe=""))
        # Body: buffered above; decode best-effort so a bad content-encoding can't error the hook.
        body = req.get_content(strict=False)
        if body and m.encode() in body:
            req.set_content(body.replace(m.encode(), token.encode()))


addons = [InjectCredentials()]
