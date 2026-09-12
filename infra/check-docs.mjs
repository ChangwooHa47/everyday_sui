// Read-only, dependency-free checks for Git-tracked and nonignored new Markdown.
// Supports common inline/reference links and images, ATX/setext headings, duplicate
// GitHub-style Unicode slugs and explicit HTML id/name anchors. Skips fenced/inline
// code, comments and external URIs. This is not a full CommonMark/MDX/HTML parser:
// raw HTML href/src, generated routes and external content are outside its scope.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const blank = value => value.replace(/[^\n\r]/g, ' ');
const unescape = value => value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1');
const label = value => unescape(value).trim().replace(/\s+/g, ' ').toLowerCase();
const lineAt = (text, offset) => text.slice(0, offset).split('\n').length;
const escaped = (text, index) => {
  let count = 0; while (index > 0 && text[--index] === '\\') count++;
  return count % 2 === 1;
};

function withoutBlocks(text) {
  let fence = null;
  return text.replace(/<!--[^]*?-->/g, blank).split('\n').map(line => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return blank(line);
    }
    if (marker) { fence = marker[1]; return blank(line); }
    return line;
  }).join('\n');
}

function withoutInlineCode(text) {
  return text.replace(/(`+)([^]*?)\1(?!`)/g, blank);
}

// Balanced labels/destinations, including escaped punctuation and (nested) paths.
function closing(text, start, open, close) {
  let depth = 1, quoted = null, angle = false;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (open === '(') {
      if (quoted) { if (text[i] === quoted) quoted = null; continue; }
      if (angle) { if (text[i] === '>') angle = false; continue; }
      if (text[i] === '<') { angle = true; continue; }
      if ((text[i] === '"' || text[i] === "'") && /\s/.test(text[i - 1])) { quoted = text[i]; continue; }
    }
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return i;
  }
  return -1;
}

function destination(value) {
  value = value.trim();
  if (!value) return '';
  const match = value.match(/^<([^>\n]*)>|^((?:\\.|[^\s])+)/);
  return match ? unescape(match[1] ?? match[2]) : null;
}

function links(text) {
  let source = withoutInlineCode(withoutBlocks(text));
  const definitions = new Map(), found = [], missing = [];
  source = source.replace(/^ {0,3}\[([^\]\n]+)\]:[ \t]*(.*)$/gm, (whole, name, first, offset) => {
    const next = source.slice(offset + whole.length).match(/^\n[ \t]+([^\n]+)/)?.[1];
    const target = destination(first.trim() || next || '');
    if (target !== null && !definitions.has(label(name))) {
      definitions.set(label(name), target); found.push({ target, offset });
    }
    return blank(whole);
  });
  for (let start = 0; start < source.length; start++) {
    if (source[start] !== '[' || escaped(source, start)) continue;
    const end = closing(source, start, '[', ']');
    if (end < 0) continue;
    const name = source.slice(start + 1, end);
    const whitespace = source.slice(end + 1).match(/^[ \t]*(?:\n[ \t]*)?/)?.[0].length ?? 0;
    const after = end + 1 + whitespace;
    if (source[after] === '(') {
      const finish = closing(source, after, '(', ')');
      if (finish >= 0) {
        const target = destination(source.slice(after + 1, finish));
        if (target !== null) found.push({ target, offset: start });
        start = finish; continue;
      }
    } else if (source[after] === '[') {
      const finish = closing(source, after, '[', ']');
      if (finish >= 0) {
        const ref = label(source.slice(after + 1, finish) || name);
        if (definitions.has(ref)) found.push({ target: definitions.get(ref), offset: start });
        else missing.push({ offset: start, message: 'Undefined Markdown link reference' });
        start = finish; continue;
      }
    }
    if (definitions.has(label(name))) found.push({ target: definitions.get(label(name)), offset: start });
    start = end;
  }
  return { found, missing };
}

function entities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, name) => {
    if (name[0] !== '#') return named[name.toLowerCase()];
    const number = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole;
  });
}

function anchors(text) {
  const source = withoutBlocks(text), result = new Set(), lines = source.split('\n');
  for (const match of source.matchAll(/<[a-z][^>]*\s(?:id|name)\s*=\s*["']([^"']+)["'][^>]*>/gi)) result.add(entities(match[1]));
  const add = heading => {
    const content = entities(unescape(heading.replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]*>/g, '')
      .replace(/(^|\s)(\*{1,3}|_{1,3})(\S(?:.*?\S)?)\2(?=\s|$)/g, '$1$3')));
    const base = content.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
    let slug = base, suffix = 0;
    while (result.has(slug)) slug = `${base}-${++suffix}`;
    result.add(slug);
  };
  for (let i = 0; i < lines.length; i++) {
    const atx = lines[i].match(/^ {0,3}#{1,6}(?:[ \t]+(.*)|$)/);
    if (atx) add((atx[1] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim());
    else if (i > 0 && /^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[i]) && lines[i - 1].trim()) add(lines[i - 1].trim());
  }
  return result;
}

function localTarget(target, file) {
  if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//')) return null;
  const hash = target.indexOf('#');
  const fragment = hash < 0 ? '' : decodeURIComponent(target.slice(hash + 1));
  const path = decodeURIComponent((hash < 0 ? target : target.slice(0, hash)).split('?')[0]);
  const absolute = path ? resolve(path.startsWith('/') ? root : dirname(file), path.replace(/^\/+/, '')) : file;
  const rel = relative(root, absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error('Local link leaves the repository');
  return { absolute, fragment };
}

function selfTest() {
  const source = '# 한글 & 코드\n## Repeat\n## Repeat\nSetext\n---\n\n'
    + '[inline](<docs/file (one).md#한글> "Title") ![image](img\\(1\\).png) [text][ref] [ref][] [ref]\n'
    + '[ref]: target.md#repeat-1\n\n`[ignored](bad.md)`\n```md\n[ignored](bad.md)\n```\n<!-- [ignored](bad.md) -->\n';
  const parsed = links(source);
  assert.deepEqual(parsed.missing, []);
  assert.equal(parsed.found.length, 6);
  assert.ok(parsed.found.some(link => link.target === 'docs/file (one).md#한글'));
  assert.ok(parsed.found.some(link => link.target === 'img(1).png'));
  assert.ok(parsed.found.every(link => !link.target.includes('bad.md')));
  assert.deepEqual([...anchors(source)], ['한글--코드', 'repeat', 'repeat-1', 'setext']);
  assert.equal(links('[label][missing]').missing.length, 1);
  assert.equal(links('ordinary [brackets]').found.length, 0);
  assert.equal(links('[ref]: target.md\n    [another](other.md)').found.length, 2);
  assert.equal(links('[ref]:\n  target.md\n\n[ref]').found.at(-1).target, 'target.md');
  assert.deepEqual([...anchors('## **Bold** `code` _emphasis_ a_b_c\n<a id="custom"></a>')], ['custom', 'bold-code-emphasis-a_b_c']);
  assert.equal(localTarget('https://example.test/a#b', resolve(root, 'README.md')), null);
  assert.equal(localTarget('#repeat', resolve(root, 'README.md')).fragment, 'repeat');
  assert.throws(() => localTarget('../outside.md', resolve(root, 'README.md')));
  assert.throws(() => decode(Uint8Array.of(0xc3, 0x28)));
  console.log('Documentation checker self-test passed (links, code exclusions, anchors, paths, UTF-8).');
}

function check() {
  const paths = decode(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }));
  const files = [...new Set(paths.split('\0').filter(path => /\.(?:md|markdown)$/i.test(path)))].sort();
  const documents = new Map(), errors = [];
  const counts = { files: 0, deleted: 0, localDestinations: 0, anchors: 0, externalSkipped: 0 };
  const fail = (path, line, message) => errors.push(`${path}:${line}: ${message}`);
  for (const path of files) {
    const absolute = resolve(root, path);
    let bytes;
    try {
      if (lstatSync(absolute).isSymbolicLink()) { fail(path, 1, 'Markdown symlink content is not inspected'); continue; }
      if (!statSync(absolute).isFile()) continue;
      const actual = relative(realpathSync(root), realpathSync(absolute));
      if (actual.startsWith(`..${sep}`) || isAbsolute(actual)) { fail(path, 1, 'Markdown path leaves the repository'); continue; }
      bytes = readFileSync(absolute);
    }
    catch (error) { if (error.code === 'ENOENT') { counts.deleted++; continue; } fail(path, 1, `Cannot read Markdown (${error.code ?? 'I/O error'})`); continue; }
    counts.files++;
    let text;
    try { text = decode(bytes); } catch {
      let start = 0, line = 1;
      for (let end = 0; end <= bytes.length; end++) if (end === bytes.length || bytes[end] === 10) {
        try { decode(bytes.subarray(start, end)); } catch { break; }
        start = end + 1; line++;
      }
      fail(path, line, 'Invalid UTF-8'); continue;
    }
    // A separator by itself can be a valid setext heading; conflict start/base/end are unambiguous.
    for (const match of text.matchAll(/^(?:<{7}|>{7}|\|{7})(?:[ \t].*)?\r?$/gm)) fail(path, lineAt(text, match.index), 'Unresolved Git conflict marker');
    documents.set(absolute, { path, text, anchors: anchors(text) });
  }
  for (const [absolute, doc] of documents) {
    const parsed = links(doc.text);
    for (const issue of parsed.missing) fail(doc.path, lineAt(doc.text, issue.offset), issue.message);
    for (const link of parsed.found) {
      const line = lineAt(doc.text, link.offset);
      let target;
      try { target = localTarget(link.target, absolute); }
      catch (error) { fail(doc.path, line, error instanceof URIError ? 'Invalid URL encoding in local link' : error.message); continue; }
      if (!target) { counts.externalSkipped++; continue; }
      counts.localDestinations++;
      try { statSync(target.absolute); }
      catch { fail(doc.path, line, `Missing local target: ${relative(root, target.absolute).split(sep).join('/')}`); continue; }
      // Never read ignored/outside Markdown to validate an anchor.
      const destinationDoc = documents.get(target.absolute);
      if (target.fragment && destinationDoc && /\.(?:md|markdown)$/i.test(extname(target.absolute))) {
        counts.anchors++;
        if (!destinationDoc.anchors.has(target.fragment)) fail(doc.path, line, `Missing Markdown anchor: #${target.fragment}`);
      }
    }
  }
  for (const error of errors) console.error(error);
  console.log(`Documentation integrity: ${errors.length ? 'FAILED' : 'passed'}; ${JSON.stringify({ ...counts, errors: errors.length })}`);
  console.log('Scope: common Markdown links/images and local Markdown anchors; no network, raw HTML/MDX links, ignored document content, or execution/claim verification.');
  if (errors.length) process.exitCode = 1;
}

if (process.argv.includes('--self-test')) selfTest();
else if (process.argv.includes('--help')) console.log('node infra/check-docs.mjs [--self-test]\nChecks tracked/nonignored Markdown UTF-8, Git conflict markers, common local links/images and heading anchors. Read-only; no network.');
else check();
