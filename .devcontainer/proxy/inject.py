"""Allowlist enforcement and credential injection for the egress proxy (mitmproxy addon).

The gateway admits a connection by address, which any host sharing that address satisfies, so this
addon authorises the name the client asks for in the TLS handshake and kills anything the allowlist
does not declare. Permitted destinations pass through undecrypted unless they inject a secret.

The client sends a fixed placeholder in place of every secret. For each intercepted request, this
addon replaces that placeholder with the real secret for the destination, chosen by the connection's
verified identity, in the sites the allowlist declares for that host. Real secrets stay proxy-side
and the client only ever holds the placeholder.

Sites default to headers, where a credential is a header the client deliberately set and the
destination consumes at its edge. A host that authenticates by query parameter or by posting its
secret in a body, as OAuth token exchange does, declares those sites itself. A request body is
excluded by default because it carries client content: an agent whose conversation quotes the
placeholder would otherwise have its real secret spliced into the prompt.

Responses take the reverse trip. A secret appearing in one is masked before it reaches the client,
so a destination that quotes request content back hands the client filler. Masking matches the
secret byte for byte, and a destination that re-encodes it first (base64, escaping) echoes it on.

Inputs:
  config    which destination injects which named secret, and into which sites
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

# Where in a request a host may carry its credential, and what it carries there unless it says so.
SITES = frozenset({"header", "query", "body"})
DEFAULT_SITES = frozenset({"header"})


def _parse_secrets(text):
    """Parse the secrets file into a name-to-value mapping, trimming whitespace and quotes."""
    out = {}
    # Keep the last NAME=token line that carries a value.
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


def _match_key(host):
    """Normalise a config key to the form an SNI is matched against, or None if it is malformed."""
    if host.startswith("*."):
        return host[1:]  # "*.example.com" matches as the suffix ".example.com"
    if "*" in host:
        logging.warning(f"o3s: {host} is a partial wildcard, ignoring the entry")
        return None
    return host


def _parse_sites(host, value):
    """Resolve a host's declared injection sites, dropping any name this addon does not know."""
    if value is None:
        return DEFAULT_SITES
    if not isinstance(value, list):
        logging.warning(f"o3s: {host} inject wants a list of {sorted(SITES)}, using the default")
        return DEFAULT_SITES
    named = frozenset(value)
    unknown = named - SITES
    if unknown:
        logging.warning(f"o3s: {host} inject names unknown site {sorted(unknown)}, ignoring it")
    return named & SITES


def _prefix_overlap(buf: bytes, tok: bytes) -> int:
    """Length of the tail of buf that could be the opening bytes of tok."""
    # Take the longest tail first, so the answer is the most that could still be held back.
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
        # Maps each intercepted host to the request sites it carries its credential in.
        self._sites = {}
        # Every key the allowlist declares, and the subset of them permitted on HTTPS.
        self._keys = frozenset()
        self._allowed = frozenset()
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
        sites = {}
        keys = set()
        allowed = set()
        # Index every table by its match key, keeping the secret and sites it declares alongside.
        for host, spec in cfg.items():
            if not isinstance(spec, dict):
                continue
            key = _match_key(host)
            if key is None:
                continue
            keys.add(key)
            if 443 in (spec.get("ports") or ()):
                allowed.add(key)
            name = spec.get("secret")
            if name:
                hosts[key] = secrets.get(name)  # None until the secret is filled in
                sites[key] = _parse_sites(host, spec.get("inject"))
        self._hosts = hosts
        self._sites = sites
        self._keys = frozenset(keys)
        self._allowed = frozenset(allowed)

    def _resolve(self, sni: str):
        """Match a name to its allowlist key: the exact entry, else the nearest `*.` entry above it.

        Walking outwards from the first dot takes the most specific entry first, so a name lands on
        its own entry before any wildcard, and on the closest wildcard before a broader one.
        """
        if sni in self._keys:
            return sni
        pos = sni.find(".", 1)
        # Drop one label at a time, so the nearest wildcard answers before a broader one.
        while pos != -1:
            if sni[pos:] in self._keys:
                return sni[pos:]
            pos = sni.find(".", pos + 1)
        return None

    def _permits(self, sni: str) -> bool:
        """Accept a name whose allowlist entry declares HTTPS."""
        return self._resolve(sni) in self._allowed

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
        # Rewrite per unique name, preserving duplicate headers.
        for name in names:
            resp.headers.set_all(
                name, [v.replace(token, mask) for v in resp.headers.get_all(name)]
            )
        logging.warning(f"o3s: masked {host} secret echoed in a response header")

    def tls_clienthello(self, data: tls.ClientHelloData) -> None:
        """Pass connections we do not inject straight through, untouched."""
        self._load()
        if self._resolve(data.client_hello.sni or "") not in self._hosts:
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
        if self._resolve(flow.client_conn.sni or "") in self._hosts:
            flow.request.anticomp()

    def responseheaders(self, flow: http.HTTPFlow) -> None:
        """Stream an intercepted response through, masking the secret as it passes."""
        self._load()
        host = flow.client_conn.sni or ""
        key = self._resolve(host)
        if key not in self._hosts:
            return
        resp = flow.response
        token = self._hosts[key]
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
        """Replace the placeholder with the destination's secret in the sites it declares."""
        self._load()
        host = flow.client_conn.sni or ""
        key = self._resolve(host)
        if key not in self._hosts:
            return
        m = self.marker
        if not m:
            return
        req = flow.request
        # Locate the placeholder in the sites this host declares, leaving the rest unread.
        sites = self._sites.get(key, DEFAULT_SITES)
        hdr_names = (
            {k for k, v in req.headers.items(multi=True) if m in v} if "header" in sites else ()
        )
        in_path = "query" in sites and m in req.path
        body = req.get_content(strict=False) if "body" in sites else None
        in_body = bool(body) and m.encode() in body
        if not (hdr_names or in_path or in_body):
            return
        # A secret waiting for its token substitutes empty, leaving the destination to answer.
        token = self._hosts.get(key) or ""
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
