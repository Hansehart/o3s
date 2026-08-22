"""Allowlist enforcement and credential injection for the egress proxy (mitmproxy addon).

The gateway admits a connection by address, which any host sharing that address satisfies, so this
addon authorises the name the client asks for in the TLS handshake and kills anything the allowlist
does not declare. Permitted destinations pass through undecrypted unless they inject a secret.

The client sends a fixed placeholder in place of every secret. For each intercepted request,
this addon replaces that placeholder with the real secret for the destination, chosen by the
connection's verified identity, wherever the placeholder appears. The client decides where the
secret goes, so no provider-specific knowledge is needed; real secrets stay proxy-side and the
client only ever holds the placeholder.

Responses take the reverse trip. A secret appearing in one is masked before it reaches the client,
so a destination that quotes request content back hands the client filler. Masking matches the
secret byte for byte, and a destination that re-encodes it first (base64, escaping) echoes it on.

Inputs:
  config    which destination injects which named secret
  secrets   the real value for each named secret
  marker    the placeholder the client sends in place of a secret
"""

import logging
import os
import re
from pathlib import Path
from urllib.parse import quote

import tomllib
from mitmproxy import http, tls
from mitmproxy.proxy import server_hooks

CONFIG_FILE = os.environ.get("O3S_CONFIG_FILE", "/etc/o3s/config.toml")
SECRETS_FILE = os.environ.get("O3S_SECRETS_FILE", "/config/secrets.env")


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


def _prefix_overlap(buf: bytes, tok: bytes) -> int:
    """Length of the tail of buf that could be the opening bytes of tok."""
    for k in range(min(len(buf), len(tok) - 1), 0, -1):
        if buf.endswith(tok[:k]):
            return k
    return 0


class InjectCredentials:
    """Swap the client's placeholder for the destination's real secret."""

    def __init__(self):
        self.marker = os.environ.get("O3S_MARKER", "")
        self._sig = None
        # Maps each intercepted host to its resolved secret, or None until the secret is filled in.
        self._hosts = {}
        # Every host the allowlist permits on HTTPS, matched against the name in the handshake.
        self._allowed = ()
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
        allowed = []
        for host, spec in cfg.items():
            if not isinstance(spec, dict):
                continue
            if 443 in (spec.get("ports") or ()):
                allowed.append(host)
            name = spec.get("secret")
            if name:
                hosts[host] = secrets.get(name)  # None until the secret is filled in
        self._hosts = hosts
        self._allowed = tuple(allowed)

    def _permits(self, sni: str) -> bool:
        """Accept a name the allowlist declares, covering its subdomains as dnsmasq does."""
        return any(sni == host or sni.endswith("." + host) for host in self._allowed)

    def _masker(self, tok: bytes, host: str):
        """Mask the secret with same-length filler as a body streams past.

        The response headers, content-length included, go out before the first chunk arrives, so
        the replacement holds the original length. A secret split across two chunks is caught by
        holding back the tail that could be its opening bytes, which for a high-entropy secret is
        empty on all but a vanishing fraction of chunks.
        """
        mask = b"*" * len(tok)
        carry = b""
        logged = False

        def mask_chunk(data: bytes):
            nonlocal carry, logged
            buf = carry + data
            if tok in buf:
                buf = buf.replace(tok, mask)
                if not logged:
                    logged = True
                    logging.warning(f"o3s: masked {host} secret echoed in a response body")
            # The final call arrives with b"" and releases whatever is still held back.
            cut = len(buf) - _prefix_overlap(buf, tok) if data else len(buf)
            carry = buf[cut:]
            # Hand back an empty list to hold a chunk back, keeping the body open.
            return buf[:cut] or []

        return mask_chunk

    def _mask_headers(self, resp: http.Response, token: str, host: str) -> None:
        """Mask the secret in response headers, which carry no length commitment."""
        names = {k for k, v in resp.headers.items(multi=True) if token in v}
        if not names:
            return
        mask = "*" * len(token)
        for name in names:
            resp.headers.set_all(
                name, [v.replace(token, mask) for v in resp.headers.get_all(name)]
            )
        logging.warning(f"o3s: masked {host} secret echoed in a response header")

    def tls_clienthello(self, data: tls.ClientHelloData) -> None:
        """Pass connections we do not inject straight through, untouched."""
        self._load()
        if (data.client_hello.sni or "") not in self._hosts:
            data.ignore_connection = True

    def server_connect(self, data: server_hooks.ServerConnectionHookData) -> None:
        """Let the connection reach a destination the allowlist names, and kill the rest.

        The address is already allow-listed by the gateway, which admits any host sharing it, so
        this authorises the name the client asked for and closes the gap between the two.
        """
        self._load()
        sni = data.client.sni or ""
        if self._permits(sni):
            return
        data.server.error = "not in the o3s allowlist"
        shown = re.sub(r"[^\w.:-]", "?", sni) if sni else "no SNI"
        logging.warning(f"o3s: refused {shown} to {data.server.address}, not allow-listed")

    def requestheaders(self, flow: http.HTTPFlow) -> None:
        """Ask for an uncompressed reply, so an echoed secret stays visible on the way back."""
        self._load()
        if (flow.client_conn.sni or "") in self._hosts:
            flow.request.anticomp()

    def responseheaders(self, flow: http.HTTPFlow) -> None:
        """Stream an intercepted response through, masking the secret as it passes."""
        self._load()
        host = flow.client_conn.sni or ""
        if host not in self._hosts:
            return
        resp = flow.response
        token = self._hosts[host]
        if not token:
            resp.stream = True
            return
        self._mask_headers(resp, token, host)
        if resp.headers.get("content-encoding", "identity").lower() in ("", "identity"):
            resp.stream = self._masker(token.encode(), host)
        else:
            # A compressed body reads as noise chunk by chunk, so buffer it and mask it whole.
            resp.stream = False
            flow.metadata["o3s_mask"] = token

    def response(self, flow: http.HTTPFlow) -> None:
        """Mask the secret in a buffered body, which responseheaders deferred to here."""
        token = flow.metadata.pop("o3s_mask", None)
        if not token:
            return
        body = flow.response.get_content(strict=False)
        if body and token.encode() in body:
            flow.response.set_content(body.replace(token.encode(), b"*" * len(token)))
            logging.warning(
                f"o3s: masked {flow.client_conn.sni} secret echoed in a response body"
            )

    def request(self, flow: http.HTTPFlow) -> None:
        """Replace the placeholder with the destination's secret wherever it appears."""
        self._load()
        host = flow.client_conn.sni or ""
        if host not in self._hosts:
            return
        m = self.marker
        if not m:
            return
        req = flow.request
        # Locate the placeholder that marks a request for injection.
        hdr_names = {k for k, v in req.headers.items(multi=True) if m in v}
        in_path = m in req.path
        body = req.get_content(strict=False)
        in_body = bool(body) and m.encode() in body
        if not (hdr_names or in_path or in_body):
            return
        token = self._hosts.get(host)
        if not token:
            # The placeholder is present but no secret is configured, so reject the request.
            flow.response = http.Response.make(
                502,
                b"o3s: no secret configured for this host\n",
                {"Content-Type": "text/plain"},
            )
            return
        # Headers: replace per unique name to preserve duplicate headers.
        for name in hdr_names:
            req.headers.set_all(
                name, [v.replace(m, token) for v in req.headers.get_all(name)]
            )
        # Query: percent-encode the token so it stays valid in the URL.
        if in_path:
            req.path = req.path.replace(m, quote(token, safe=""))
        # Body: decode best-effort so any content-encoding is handled.
        if in_body:
            req.set_content(body.replace(m.encode(), token.encode()))


addons = [InjectCredentials()]
