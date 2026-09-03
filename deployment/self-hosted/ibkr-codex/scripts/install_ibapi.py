"""Install the pinned official IBKR SDK; the PyPI 9.81 package is obsolete."""
import hashlib
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

URL = "https://interactivebrokers.github.io/downloads/twsapi_macunix.1050.01.zip"
SHA256 = "aa065722ca732a41aab202c7bb72932e179b86e7ec51cefa063eb1983fe9f597"

with tempfile.TemporaryDirectory(prefix="ibkr-sdk-") as directory:
    archive = Path(directory) / "sdk.zip"
    urllib.request.urlretrieve(URL, archive)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
        raise RuntimeError("Official IBKR SDK archive checksum mismatch")
    with zipfile.ZipFile(archive) as bundle:
        bundle.extractall(directory)
    subprocess.run([sys.executable, "-m", "pip", "install",
                    str(Path(directory) / "IBJts/source/pythonclient")], check=True)
