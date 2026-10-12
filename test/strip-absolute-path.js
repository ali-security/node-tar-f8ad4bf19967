const t = require('tap')
const stripAbsolutePath = require('../lib/strip-absolute-path.js')

t.test('basic', t => {
  const cases = {
    '/': ['/', ''],
    '////': ['////', ''],
    'c:///a/b/c': ['c:///', 'a/b/c'],
    '\\\\foo\\bar\\baz': ['\\\\foo\\bar\\', 'baz'],
    '//foo//bar//baz': ['//', 'foo//bar//baz'],
    'c:\\c:\\c:\\c:\\\\d:\\e/f/g': ['c:\\c:\\c:\\c:\\\\d:\\', 'e/f/g'],
  }

  for (const [input, [root, stripped]] of Object.entries(cases))
    t.strictSame(stripAbsolutePath(input), [root, stripped], input)
  t.end()
})

// strip-absolute-path always parses with path.win32, so the windows
// drive-relative cases can be checked on any platform.
t.test('drive-local paths', t => {
  const cases = {
    '/': ['/', ''],
    '////': ['////', ''],
    'c:///a/b/c': ['c:///', 'a/b/c'],
    '\\\\foo\\bar\\baz': ['\\\\foo\\bar\\', 'baz'],
    '//foo//bar//baz': ['//', 'foo//bar//baz'],
    'c:\\c:\\c:\\c:\\\\d:\\e/f/g': ['c:\\c:\\c:\\c:\\\\d:\\', 'e/f/g'],
    'c:..\\system\\explorer.exe': ['c:', '..\\system\\explorer.exe'],
    'd:..\\..\\unsafe\\land': ['d:', '..\\..\\unsafe\\land'],
    'c:foo': ['c:', 'foo'],
    'D:mark': ['D:', 'mark'],
    '//?/X:/y/z': ['//?/X:/', 'y/z'],
    '\\\\?\\X:\\y\\z': ['\\\\?\\X:\\', 'y\\z'],
  }
  for (const [input, [root, stripped]] of Object.entries(cases)) {
    if (!t.strictSame(stripAbsolutePath(input), [root, stripped], input))
      break
  }
  t.end()
})
