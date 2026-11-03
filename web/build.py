#!/usr/bin/env python3
"""Crea la webapp in un solo file HTML (stile, script e nomi delle skill inclusi): si apre anche offline.

Uso:
    python3 web/build.py                       # -> dist/UmaStatsTT.html
    python3 web/build.py --out mia.html
    python3 web/build.py --demo-js esempio.js  # usa un altro demo.js (dati caricati all'apertura)
    python3 web/build.py --fragment            # senza <html>/<head>/<body>, per pagine che li aggiungono da sole
"""
import argparse
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def build(demo_js=None, fragment=False):
    html = read(os.path.join(HERE, "index.html"))
    css = read(os.path.join(HERE, "style.css"))
    html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + css + "\n</style>")

    def inline(m):
        name = m.group(1)
        path = demo_js if (name == "demo.js" and demo_js) else os.path.join(HERE, name)
        code = read(path).replace("</script", "<\\/script")
        return "<script>\n" + code + "\n</script>"

    html = re.sub(r'<script src="([\w.]+\.js)"></script>', inline, html)
    if fragment:
        for pat in (r"<!doctype html>\s*", r"<html[^>]*>\s*", r"</?head>\s*", r"</?body>\s*", r"</html>\s*",
                    r'<meta charset="utf-8">\s*', r'<meta name="viewport"[^>]*>\s*'):
            html = re.sub(pat, "", html, flags=re.I)
    return html


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=os.path.join(HERE, "..", "dist", "UmaStatsTT.html"))
    ap.add_argument("--demo-js", help="file JavaScript che definisce window.UMA_DEMO")
    ap.add_argument("--fragment", action="store_true", help="senza i tag html/head/body")
    args = ap.parse_args()
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(build(args.demo_js, args.fragment))
    print(f"Creato {out} ({os.path.getsize(out) // 1024} KB)")


if __name__ == "__main__":
    main()
