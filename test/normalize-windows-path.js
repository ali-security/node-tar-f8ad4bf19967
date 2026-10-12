const t = require('tap')

const realPlatform = process.platform
const fakePlatform = realPlatform === 'win32' ? 'posix' : 'win32'

function reload(mod) {
  delete require.cache[require.resolve(mod)];
  return require(mod)
}

t.test('posix', t => {
  if (realPlatform === 'win32')
    process.env.TESTING_TAR_FAKE_PLATFORM = fakePlatform
  else
    delete process.env.TESTING_TAR_FAKE_PLATFORM
  const normPath = reload('../lib/normalize-windows-path.js')
  t.equal(normPath('/some/path/back\\slashes'), '/some/path/back\\slashes')
  t.equal(normPath('c:\\foo\\bar'), 'c:\\foo\\bar')
  // a pax header can carry a path that looks like a number; everything
  // downstream of here does string work on it, so hand back a string
  t.equal(normPath(12345), '12345')
  t.equal(typeof normPath(12345), 'string')
  // a missing path is passed through as it is
  t.equal(normPath(undefined), undefined)
  t.end()
})

t.test('win32', t => {
  if (realPlatform !== 'win32')
    process.env.TESTING_TAR_FAKE_PLATFORM = fakePlatform
  else
    delete process.env.TESTING_TAR_FAKE_PLATFORM
  const normPath = reload('../lib/normalize-windows-path.js')
  t.equal(normPath('/some/path/back\\slashes'), '/some/path/back/slashes')
  t.equal(normPath('c:\\foo\\bar'), 'c:/foo/bar')
  t.equal(normPath(12345), '12345')
  t.equal(typeof normPath(12345), 'string')
  t.equal(normPath(undefined), undefined)
  t.end()
})
