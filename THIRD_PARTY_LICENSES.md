# Third-party licenses

OpenFirst is built on very few external dependencies by design (see the
"dependency-free" rationale in `app/src/lib/markdown.js`). The only
third-party code that ships inside the built app is listed below.
Build-only tooling (Svelte, Vite, its plugins, puppeteer-core) is not
included here since none of it is redistributed as part of the app.

## fflate

- **Used for:** unzipping legacy `.zip` package imports, kept for backward
  compatibility with older backups (`app/src/lib/load.js`)
- **Version:** 0.8.3
- **License:** MIT
- **Homepage:** https://github.com/101arrowz/fflate

```
MIT License

Copyright (c) 2026 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
