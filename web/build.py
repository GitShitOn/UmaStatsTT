#!/usr/bin/env python3
"""Bundles the web app into a single HTML file (styles, scripts and skill names included): works offline too.

Usage:
    python3 web/build.py                       # -> dist/UmaStatsTT.html
    python3 web/build.py --out my.html
    python3 web/build.py --demo-js sample.js   # use another demo.js (data loaded when the page opens)
    python3 web/build.py --fragment            # without <html>/<head>/<body>, for hosts that add them
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
    ap.add_argument("--demo-js", help="JavaScript file that defines window.UMA_DEMO")
    ap.add_argument("--fragment", action="store_true", help="without the html/head/body tags")
    args = ap.parse_args()
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(build(args.demo_js, args.fragment))
    print(f"Created {out} ({os.path.getsize(out) // 1024} KB)")


if __name__ == "__main__":
    main()
