'use strict'

process.umask(0o022)

const Unpack = require('../lib/unpack.js')
const UnpackSync = Unpack.Sync
const t = require('tap')
const MiniPass = require('minipass')

const makeTar = require('./make-tar.js')
const Header = require('../lib/header.js')
const Pax = require('../lib/pax.js')
const z = require('minizlib')
const fs = require('fs')
const path = require('path')
const fixtures = path.resolve(__dirname, 'fixtures')
const files = path.resolve(fixtures, 'files')
const tars = path.resolve(fixtures, 'tars')
const parses = path.resolve(fixtures, 'parse')
const unpackdir = path.resolve(fixtures, 'unpack')
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const mutateFS = require('mutate-fs')
const eos = require('end-of-stream')
const isWindows = process.platform === 'win32'
const ReadEntry = require('../lib/read-entry.js')

t.teardown(_ => rimraf.sync(unpackdir))

t.test('setup', t => {
  rimraf.sync(unpackdir)
  mkdirp.sync(unpackdir)
  t.end()
})

t.test('basic file unpack tests', t => {
  const basedir = path.resolve(unpackdir, 'basic')
  t.teardown(_ => rimraf.sync(basedir))

  const cases = {
    'emptypax.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'one-byte.txt': 'a'
    },
    'body-byte-counts.tar': {
      '1024-bytes.txt': new Array(1024).join('x') + '\n',
      '512-bytes.txt': new Array(512).join('x') + '\n',
      'one-byte.txt': 'a',
      'zero-byte.txt': ''
    },
    'utf8.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'Ω.txt': 'Ω',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω'
    },
    'file.tar': {
      'one-byte.txt': 'a'
    },
    'global-header.tar': {
      'one-byte.txt': 'a'
    },
    'long-pax.tar': {
      '120-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    },
    'long-paths.tar': {
      '100-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '120-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '170-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/a.txt': 'short\n',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω'
    }
  }

  const tarfiles = Object.keys(cases)
  t.plan(tarfiles.length)
  t.jobs = tarfiles.length

  tarfiles.forEach(tarfile => {
    t.test(tarfile, t => {
      const tf = path.resolve(tars, tarfile)
      const dir = path.resolve(basedir, tarfile)
      const linkdir = path.resolve(basedir, tarfile + '.link')
      t.beforeEach(cb => {
        rimraf.sync(dir)
        rimraf.sync(linkdir)
        mkdirp.sync(dir)
        fs.symlinkSync(dir, linkdir)
        cb()
      })

      const check = t => {
        const expect = cases[tarfile]
        Object.keys(expect).forEach(file => {
          const f = path.resolve(dir, file)
          t.equal(fs.readFileSync(f, 'utf8'), expect[file], file)
        })
        t.end()
      }

      t.plan(2)

      t.test('async unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new Unpack({ cwd: linkdir, strict: true })
          fs.createReadStream(tf).pipe(unpack)
          eos(unpack, _ => check(t))
        })
        t.test('loose', t => {
          const unpack = new Unpack({ cwd: linkdir })
          fs.createReadStream(tf).pipe(unpack)
          eos(unpack, _ => check(t))
        })
      })

      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new UnpackSync({ cwd: linkdir })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
        t.test('loose', t => {
          const unpack = new UnpackSync({ cwd: linkdir })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
      })
    })
  })
})

t.test('cwd default to process cwd', t => {
  const u = new Unpack()
  const us = new UnpackSync()
  const cwd = process.cwd()
  t.equal(u.cwd, cwd)
  t.equal(us.cwd, cwd)
  t.end()
})

t.test('links!', t => {
  const dir = path.resolve(unpackdir, 'links')
  const data = fs.readFileSync(tars + '/links.tar')
  const stripData = fs.readFileSync(tars + '/links-strip.tar')

  t.plan(6)
  t.beforeEach(cb => mkdirp(dir, cb))
  t.afterEach(cb => rimraf(dir, cb))

  const check = t => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    t.equal(hl1.dev, hl2.dev)
    t.equal(hl1.ino, hl2.ino)
    t.equal(hl1.nlink, 2)
    t.equal(hl2.nlink, 2)
    const sym = fs.lstatSync(dir + '/symlink')
    t.ok(sym.isSymbolicLink())
    t.equal(fs.readlinkSync(dir + '/symlink'), 'hardlink-2')
    t.end()
  }
  const checkForStrip = t => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    const hl3 = fs.lstatSync(dir + '/1/2/3/hardlink-3')
    t.equal(hl1.dev, hl2.dev)
    t.equal(hl1.ino, hl2.ino)
    t.equal(hl1.dev, hl3.dev)
    t.equal(hl1.ino, hl3.ino)
    t.equal(hl1.nlink, 3)
    t.equal(hl2.nlink, 3)
    const sym = fs.lstatSync(dir + '/symlink')
    t.ok(sym.isSymbolicLink())
    t.equal(fs.readlinkSync(dir + '/symlink'), 'hardlink-2')
    t.end()
  }
  const checkForStrip3 = t => {
    t.ok(fs.lstatSync(dir + '/3').isDirectory())
    let err = null
    try {
      fs.lstatSync(dir + '/3/hardlink-3')
    } catch(e) {
      err = e
    }
    // can't be extracted because we've passed it in the tar (specially crafted tar for this not to work)
    t.equal(err.code, 'ENOENT')
    t.end()
  }

  t.test('async', t => {
    const unpack = new Unpack({ cwd: dir })
    let finished = false
    unpack.on('finish', _ => finished = true)
    unpack.on('close', _ => t.ok(finished, 'emitted finish before close'))
    unpack.on('close', _ => check(t))
    unpack.end(data)
  })

  t.test('sync', t => {
    const unpack = new UnpackSync({ cwd: dir })
    unpack.end(data)
    check(t)
  })

  t.test('sync strip', t => {
    const unpack = new UnpackSync({ cwd: dir, strip: 1 })
    unpack.end(fs.readFileSync(tars + '/links-strip.tar'))
    checkForStrip(t)
  })

  t.test('async strip', t => {
    const unpack = new Unpack({ cwd: dir, strip: 1 })
    let finished = false
    unpack.on('finish', _ => finished = true)
    unpack.on('close', _ => t.ok(finished, 'emitted finish before close'))
    unpack.on('close', _ => checkForStrip(t))
    unpack.end(stripData)
  })

  t.test('sync strip 3', t => {
    const unpack = new UnpackSync({ cwd: dir, strip: 3 })
    unpack.end(fs.readFileSync(tars + '/links-strip.tar'))
    checkForStrip3(t)
  })

  t.test('async strip 3', t => {
    const unpack = new Unpack({ cwd: dir, strip: 3 })
    let finished = false
    unpack.on('finish', _ => finished = true)
    unpack.on('close', _ => t.ok(finished, 'emitted finish before close'))
    unpack.on('close', _ => checkForStrip3(t))
    unpack.end(stripData)
  })
})

t.test('links without cleanup (exercise clobbering code)', t => {
  const dir = path.resolve(unpackdir, 'links')
  const data = fs.readFileSync(tars + '/links.tar')

  t.plan(6)
  mkdirp.sync(dir)
  t.teardown(_ => rimraf.sync(dir))

  t.beforeEach(cb => {
    // clobber this junk
    try {
      mkdirp.sync(dir + '/hardlink-1')
      mkdirp.sync(dir + '/hardlink-2')
      fs.writeFileSync(dir + '/symlink', 'not a symlink')
    } catch (er) {}
    cb()
  })

  const check = t => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    t.equal(hl1.dev, hl2.dev)
    t.equal(hl1.ino, hl2.ino)
    t.equal(hl1.nlink, 2)
    t.equal(hl2.nlink, 2)
    const sym = fs.lstatSync(dir + '/symlink')
    t.ok(sym.isSymbolicLink())
    t.equal(fs.readlinkSync(dir + '/symlink'), 'hardlink-2')
    t.end()
  }

  t.test('async', t => {
    const unpack = new Unpack({ cwd: dir })
    let prefinished = false
    unpack.on('prefinish', _ => prefinished = true)
    unpack.on('finish', _ =>
      t.ok(prefinished, 'emitted prefinish before finish'))
    unpack.on('close', _ => check(t))
    unpack.end(data)
  })

  t.test('sync', t => {
    const unpack = new UnpackSync({ cwd: dir })
    unpack.end(data)
    check(t)
  })

  t.test('async again', t => {
    const unpack = new Unpack({ cwd: dir })
    eos(unpack, _ => check(t))
    unpack.end(data)
  })

  t.test('sync again', t => {
    const unpack = new UnpackSync({ cwd: dir })
    unpack.end(data)
    check(t)
  })

  t.test('async unlink', t => {
    const unpack = new Unpack({ cwd: dir, unlink: true })
    unpack.on('close', _ => check(t))
    unpack.end(data)
  })

  t.test('sync unlink', t => {
    const unpack = new UnpackSync({ cwd: dir, unlink: true })
    unpack.end(data)
    check(t)
  })
})

t.test('nested dir dupe', t => {
  const dir = path.resolve(unpackdir, 'nested-dir')
  mkdirp.sync(dir + '/d/e/e/p')
  t.teardown(_ => rimraf.sync(dir))
  const expect = {
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/a.txt': 'short\n',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω'
  }

  const check = t => {
    const entries = fs.readdirSync(dir)
    t.equal(entries.length, 1)
    t.equal(entries[0], 'd')
    Object.keys(expect).forEach(f => {
      const file = dir + '/' + f
      t.equal(fs.readFileSync(file, 'utf8'), expect[f])
    })
    t.end()
  }

  const unpack = new Unpack({ cwd: dir, strip: 8 })
  const data = fs.readFileSync(tars + '/long-paths.tar')
  // while we're at it, why not use gzip too?
  const zip = new z.Gzip()
  zip.pipe(unpack)
  unpack.on('close', _ => check(t))
  zip.end(data)
})

t.test('symlink in dir path', t => {
  const dir = path.resolve(unpackdir, 'symlink-junk')

  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'd/i',
      type: 'Directory'
    },
    {
      path: 'd/i/r/dir',
      type: 'Directory',
      mode: 0o751,
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z')
    },
    'a',
    {
      path: 'd/i/r/link',
      type: 'Link',
      linkpath: 'd/i/r/file',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/symlink/x',
      type: 'File',
      size: 0,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    '',
    ''
  ])

  t.test('no clobbering', t => {
    const warnings = []
    const u = new Unpack({ cwd: dir, onwarn: (w,d) => warnings.push([w,d]) })
    u.on('close', _ => {
      t.equal(fs.lstatSync(dir + '/d/i').mode & 0o7777, 0o755)
      t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
      t.throws(_ => fs.statSync(dir + '/d/i/r/symlink/x'))
      t.equal(warnings.length, 1)
      t.equal(warnings[0][0], 'Cannot extract through symbolic link')
      t.match(warnings[0][1], {
        name: 'SylinkError',
        path: dir + '/d/i/r/symlink/',
        symlink: dir + '/d/i/r/symlink'
      })
      t.end()
    })
    u.end(data)
  })

  t.test('no clobbering, sync', t => {
    const warnings = []
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d])
    })
    u.end(data)
    t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
    t.throws(_ => fs.statSync(dir + '/d/i/r/symlink/x'))
    t.equal(warnings.length, 1)
    t.equal(warnings[0][0], 'Cannot extract through symbolic link')
    t.match(warnings[0][1], {
      name: 'SylinkError',
      path: dir + '/d/i/r/symlink/',
      symlink: dir + '/d/i/r/symlink'
    })
    t.end()
  })

  t.test('extract through symlink', t => {
    const warnings = []
    const u = new Unpack({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      preservePaths: true
    })
    u.on('close', _ => {
      t.same(warnings, [])
      t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
      t.ok(fs.lstatSync(dir + '/d/i/r/dir/x').isFile(), 'x thru link')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink/x').isFile(), 'x thru link')
      t.end()
    })
    u.end(data)
  })

  t.test('extract through symlink sync', t => {
    const warnings = []
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      preservePaths: true
    })
    u.end(data)
    t.same(warnings, [])
    t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
    t.ok(fs.lstatSync(dir + '/d/i/r/dir/x').isFile(), 'x thru link')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink/x').isFile(), 'x thru link')
    t.end()
  })

  t.test('clobber through symlink', t => {
    const warnings = []
    const u = new Unpack({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      unlink: true
    })
    u.on('close', _ => {
      t.same(warnings, [])
      t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
      t.notok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'no link')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isDirectory(), 'sym is dir')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink/x').isFile(), 'x thru link')
      t.end()
    })
    u.end(data)
  })

  t.test('clobber through symlink with busted unlink', t => {
    const poop = new Error('poop')
    t.teardown(mutateFS.fail('unlink', poop))
    const warnings = []
    const u = new Unpack({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      unlink: true
    })
    u.on('close', _ => {
      t.same(warnings, [[ 'poop', poop ]])
      t.end()
    })
    u.end(data)
  })

  t.test('clobber through symlink sync', t => {
    const warnings = []
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      unlink: true
    })
    u.end(data)
    t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
    t.notok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'no link')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isDirectory(), 'sym is dir')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink/x').isFile(), 'x thru link')
    t.end()
  })

  t.test('clobber dirs', t => {
    mkdirp.sync(dir + '/d/i/r/dir')
    mkdirp.sync(dir + '/d/i/r/file')
    mkdirp.sync(dir + '/d/i/r/link')
    mkdirp.sync(dir + '/d/i/r/symlink')
    const warnings = []
    const u = new Unpack({
      cwd: dir,
      onwarn: (w, d) => {
        warnings.push([w,d])
      }
    })
    u.on('close', _ => {
      t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
      t.throws(_ => fs.statSync(dir + '/d/i/r/symlink/x'))
      t.equal(warnings.length, 1)
      t.equal(warnings[0][0], 'Cannot extract through symbolic link')
      t.match(warnings[0][1], {
        name: 'SylinkError',
        path: dir + '/d/i/r/symlink/',
        symlink: dir + '/d/i/r/symlink'
      })
      t.end()
    })
    u.end(data)
  })

  t.test('clobber dirs sync', t => {
    mkdirp.sync(dir + '/d/i/r/dir')
    mkdirp.sync(dir + '/d/i/r/file')
    mkdirp.sync(dir + '/d/i/r/link')
    mkdirp.sync(dir + '/d/i/r/symlink')
    const warnings = []
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => {
        warnings.push([w,d])
      }
    })
    u.end(data)
    t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
    t.throws(_ => fs.statSync(dir + '/d/i/r/symlink/x'))
    t.equal(warnings.length, 1)
    t.equal(warnings[0][0], 'Cannot extract through symbolic link')
    t.match(warnings[0][1], {
      name: 'SylinkError',
      path: dir + '/d/i/r/symlink/',
      symlink: dir + '/d/i/r/symlink'
    })
    t.end()
  })

  t.end()
})

t.test('unsupported entries', t => {
  const dir = path.resolve(unpackdir, 'unsupported-entries')
  mkdirp.sync(dir)
  t.teardown(_ => rimraf.sync(dir))
  const unknown = new Header({ path: 'qux', type: 'File', size: 4 })
  unknown.type = 'Z'
  unknown.encode()
  const data = makeTar([
    {
      path: 'dev/random',
      type: 'CharacterDevice'
    },
    {
      path: 'dev/hd0',
      type: 'BlockDevice'
    },
    {
      path: 'dev/fifo0',
      type: 'FIFO'
    },
    unknown.block,
    'asdf',
    '',
    ''
  ])

  t.test('basic, warns', t => {
    const warnings = []
    const u = new Unpack({ cwd: dir, onwarn: (w,d) => warnings.push([w,d]) })
    const expect = [
      ['unsupported entry type: CharacterDevice', { path: 'dev/random' }],
      ['unsupported entry type: BlockDevice', { path: 'dev/hd0' }],
      ['unsupported entry type: FIFO', { path: 'dev/fifo0' }]
    ]
    u.on('close', _ => {
      t.equal(fs.readdirSync(dir).length, 0)
      t.match(warnings, expect)
      t.end()
    })
    u.end(data)
  })

  t.test('strict, throws', t => {
    const warnings = []
    const errors = []
    const u = new Unpack({
      cwd: dir,
      strict: true,
      onwarn: (w,d) => warnings.push([w,d])
    })
    u.on('error', e => errors.push(e))
    u.on('close', _ => {
      t.equal(fs.readdirSync(dir).length, 0)
      t.same(warnings, [])
      t.match(errors, [
        {
          message: 'unsupported entry type: CharacterDevice',
          data: { path: 'dev/random' }
        },
        {
          message: 'unsupported entry type: BlockDevice',
          data: { path: 'dev/hd0' }
        },
        {
          message: 'unsupported entry type: FIFO',
          data: { path: 'dev/fifo0' }
        }
      ])
      t.end()
    })
    u.end(data)
  })

  t.end()
})


t.test('file in dir path', t => {
  const dir = path.resolve(unpackdir, 'file-junk')

  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'a',
    {
      path: 'd/i/r/file/a/b/c',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'b',
    '',
    ''
  ])

  t.test('fail because of file', t => {
    const check = t => {
      t.equal(fs.readFileSync(dir + '/d/i/r/file', 'utf8'), 'a')
      t.throws(_ => fs.statSync(dir + '/d/i/r/file/a/b/c'))
      t.end()
    }

    t.plan(2)

    t.test('async', t => {
      new Unpack({ cwd: dir }).on('close', _ => check(t)).end(data)
    })

    t.test('sync', t => {
      new UnpackSync({ cwd: dir }).end(data)
      check(t)
    })
  })

  t.test('clobber on through', t => {
    const check = t => {
      t.ok(fs.statSync(dir + '/d/i/r/file').isDirectory())
      t.equal(fs.readFileSync(dir + '/d/i/r/file/a/b/c', 'utf8'), 'b')
      t.end()
    }

    t.plan(2)

    t.test('async', t => {
      new Unpack({ cwd: dir, unlink: true }).on('close', _ => check(t)).end(data)
    })

    t.test('sync', t => {
      new UnpackSync({ cwd: dir, unlink: true }).end(data)
      check(t)
    })
  })

  t.end()
})

t.test('set umask option', t => {
  const dir = path.resolve(unpackdir, 'umask')
  mkdirp.sync(dir)
  t.tearDown(_ => rimraf.sync(dir))

  const data = makeTar([
    {
      path: 'd/i/r/dir',
      type: 'Directory',
      mode: 0o751
    },
    '',
    ''
  ])

  new Unpack({
    umask: 0o027,
    cwd: dir
  }).on('close', _ => {
    t.equal(fs.statSync(dir + '/d/i/r').mode & 0o7777, 0o750)
    t.equal(fs.statSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.end()
  }).end(data)
})

t.test('absolute paths', t => {
  const dir = path.join(unpackdir, 'absolute-paths')
  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const absolute = path.resolve(dir, 'd/i/r/absolute')
  t.ok(path.isAbsolute(absolute))
  const parsed = path.parse(absolute)
  const relative = absolute.substr(parsed.root.length)
  t.notOk(path.isAbsolute(relative))

  const data = makeTar([
    {
      path: absolute,
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'a',
    '',
    ''
  ])

  t.test('warn and correct', t => {
    const check = t => {
      t.same(warnings, [[
        'stripping / from absolute path',
        absolute
      ]])
      t.ok(fs.lstatSync(path.resolve(dir, relative)).isFile(), 'is file')
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _=> check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.test('preserve absolute path', t => {
    const check = t => {
      t.same(warnings, [])
      t.ok(fs.lstatSync(absolute).isFile(), 'is file')
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        preservePaths: true,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _=> check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        preservePaths: true,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.end()
})

t.test('.. paths', t => {
  const dir = path.join(unpackdir, 'dotted-paths')
  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const fmode = 0o755
  const dotted = 'a/b/c/../d'
  const resolved = path.resolve(dir, dotted)

  const data = makeTar([
    {
      path: dotted,
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'd',
    '',
    ''
  ])

  t.test('warn and skip', t => {
    const check = t => {
      t.same(warnings, [[
        'path contains \'..\'',
        dotted
      ]])
      t.throws(_=>fs.lstatSync(resolved))
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        fmode: fmode,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _=> check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        fmode: fmode,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.test('preserve dotted path', t => {
    const check = t => {
      t.same(warnings, [])
      t.ok(fs.lstatSync(resolved).isFile(), 'is file')
      t.equal(fs.lstatSync(resolved).mode & 0o777, fmode, 'mode is 0755')
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        fmode: fmode,
        preservePaths: true,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _=> check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        fmode: fmode,
        preservePaths: true,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.end()
})

t.test('fail all stats', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  let unmutate
  const dir = path.join(unpackdir, 'stat-fail')

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    mkdirp.sync(dir)
    unmutate = mutateFS.statFail(poop)
    cb()
  })
  t.afterEach(cb => {
    unmutate()
    rimraf.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'd/i/r/file/',
      type: 'Directory',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'a',
    {
      path: 'd/i/r/link',
      type: 'Link',
      linkpath: 'd/i/r/file',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    '',
    ''
  ])

  const check = (t, expect) => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    const expect = [
      ['poop', poop],
      ['poop', poop]
    ]
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t, expect)).end(data)
  })

  t.test('sync', t => {
    const expect = [
      [
        String,
        {
          code: 'EISDIR',
          path: path.resolve(dir, 'd/i/r/file'),
          syscall: 'open'
        }
      ],
      [
        String,
        {
          dest: path.resolve(dir, 'd/i/r/link'),
          path: path.resolve(dir, 'd/i/r/file'),
          syscall: 'link'
        }
      ]
    ]
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t, expect)
  })

  t.end()
})

t.test('fail symlink', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  const unmutate = mutateFS.fail('symlink', poop)
  const dir = path.join(unpackdir, 'symlink-fail')
  t.teardown(_ => (unmutate(), rimraf.sync(dir)))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'd/i/r/dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    '',
    ''
  ])

  const check = (t, expect) => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    const expect = [['poop', poop]]
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t, expect)).end(data)
  })

  t.test('sync', t => {
    const expect = [['poop', poop]]
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t, expect)
  })

  t.end()
})

t.test('fail chmod', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  const unmutate = mutateFS.fail('chmod', poop)
  const dir = path.join(unpackdir, 'chmod-fail')
  t.teardown(_ => (unmutate(), rimraf.sync(dir)))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'd/i/r/dir/',
      type: 'Directory',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    '',
    ''
  ])

  const check = (t, expect) => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    const expect = [['poop', poop]]
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t, expect)).end(data)
  })

  t.test('sync', t => {
    const expect = [['poop', poop]]
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t, expect)
  })

  t.end()
})

t.test('fail mkdir', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  let unmutate
  const dir = path.join(unpackdir, 'mkdir-fail')
  t.teardown(_ => rimraf.sync(dir))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    unmutate = mutateFS.fail('mkdir', poop)
    cb()
  })
  t.afterEach(cb => {
    unmutate()
    cb()
  })

  const data = makeTar([
    {
      path: 'dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    '',
    ''
  ])

  const expect = [ [
    'ENOENT: no such file or directory, lstat \'' +
    path.resolve(dir, 'dir') + '\'',
    {
      code: 'ENOENT',
      syscall: 'lstat',
      path: path.resolve(dir, 'dir')
    }
  ] ]

  const check = t => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('fail write', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  const unmutate = mutateFS.fail('write', poop)
  const dir = path.join(unpackdir, 'write-fail')
  t.teardown(_ => (unmutate(), rimraf.sync(dir)))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'x',
      type: 'File',
      size: 1,
      mode: 0o751,
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'x',
    '',
    ''
  ])

  const expect = [ [ 'poop', poop ] ]

  const check = t => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('skip existing', t => {
  const dir = path.join(unpackdir, 'skip-newer')
  t.teardown(_ => rimraf.sync(dir))

  const date = new Date('2011-03-27T22:16:31.000Z')
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    fs.writeFileSync(dir + '/x', 'y')
    fs.utimesSync(dir + '/x', date, date)
    cb()
  })

  const data = makeTar([
    {
      path: 'x',
      type: 'File',
      size: 1,
      mode: 0o751,
      mtime: new Date('2013-12-19T17:00:00.000Z')
    },
    'x',
    '',
    ''
  ])

  const check = t => {
    const st = fs.lstatSync(dir + '/x')
    t.equal(st.atime.toISOString(), date.toISOString())
    t.equal(st.mtime.toISOString(), date.toISOString())
    const data = fs.readFileSync(dir + '/x', 'utf8')
    t.equal(data, 'y')
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      keep: true
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      keep: true
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('skip newer', t => {
  const dir = path.join(unpackdir, 'skip-newer')
  t.teardown(_ => rimraf.sync(dir))

  const date = new Date('2013-12-19T17:00:00.000Z')
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    fs.writeFileSync(dir + '/x', 'y')
    fs.utimesSync(dir + '/x', date, date)
    cb()
  })

  const data = makeTar([
    {
      path: 'x',
      type: 'File',
      size: 1,
      mode: 0o751,
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'x',
    '',
    ''
  ])

  const check = t => {
    const st = fs.lstatSync(dir + '/x')
    t.equal(st.atime.toISOString(), date.toISOString())
    t.equal(st.mtime.toISOString(), date.toISOString())
    const data = fs.readFileSync(dir + '/x', 'utf8')
    t.equal(data, 'y')
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      newer: true
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      newer: true
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('no mtime', t => {
  const dir = path.join(unpackdir, 'skip-newer')
  t.teardown(_ => rimraf.sync(dir))

  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const date = new Date('2011-03-27T22:16:31.000Z')
  const data = makeTar([
    {
      path: 'x/',
      type: 'Directory',
      size: 0,
      atime: date,
      ctime: date,
      mtime: date
    },
    {
      path: 'x/y',
      type: 'File',
      size: 1,
      mode: 0o751,
      atime: date,
      ctime: date,
      mtime: date
    },
    'x',
    '',
    ''
  ])

  const check = t => {
    // this may fail if it's run on March 27, 2011
    const stx = fs.lstatSync(dir + '/x')
    t.notEqual(stx.atime.toISOString(), date.toISOString())
    t.notEqual(stx.mtime.toISOString(), date.toISOString())
    const sty = fs.lstatSync(dir + '/x/y')
    t.notEqual(sty.atime.toISOString(), date.toISOString())
    t.notEqual(sty.mtime.toISOString(), date.toISOString())
    const data = fs.readFileSync(dir + '/x/y', 'utf8')
    t.equal(data, 'x')
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      noMtime: true
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      noMtime: true
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('unpack big enough to pause/drain', t => {
  const dir = path.resolve(unpackdir, 'drain-clog')
  mkdirp.sync(dir)
  t.tearDown(_ => rimraf.sync(dir))
  const stream = fs.createReadStream(fixtures + '/parses.tar')
  const u = new Unpack({
    cwd: dir,
    strip: 3,
    strict: true
  })

  u.on('ignoredEntry', entry =>
    t.fail('should not get ignored entry: ' + entry.path))

  u.on('close', _ => {
    t.pass('extraction finished')
    const actual = fs.readdirSync(dir)
    const expected = fs.readdirSync(parses)
    t.same(actual, expected)
    t.end()
  })

  stream.pipe(u)
})

t.test('set owner', t => {
  // fake it on platforms that don't have getuid
  const myUid = 501
  const myGid = 1024
  const getuid = process.getuid
  const getgid = process.getgid
  process.getuid = _ => myUid
  process.getgid = _ => myGid
  t.teardown(_ => (process.getuid = getuid, process.getgid = getgid))

  // can't actually do this because it requires root, but we can
  // verify that chown gets called.
  t.test('as root, defaults to true', t => {
    const getuid = process.getuid
    process.getuid = _ => 0
    const u = new Unpack()
    t.equal(u.preserveOwner, true, 'preserveOwner enabled')
    process.getuid = getuid
    t.end()
  })

  t.test('as non-root, defaults to false', t => {
    const getuid = process.getuid
    process.getuid = _ => 501
    const u = new Unpack()
    t.equal(u.preserveOwner, false, 'preserveOwner disabled')
    process.getuid = getuid
    t.end()
  })

  const data = makeTar([
    {
      uid: 2456124561,
      gid: 813708013,
      path: 'foo/',
      type: 'Directory'
    },
    {
      uid: myUid,
      gid: 813708013,
      path: 'foo/my-uid-different-gid',
      type: 'File',
      size: 3
    },
    'qux',
    {
      uid: 2456124561,
      path: 'foo/different-uid-nogid',
      type: 'Directory'
    },
    {
      uid: 2456124561,
      path: 'foo/different-uid-nogid/bar',
      type: 'File',
      size: 3
    },
    'qux',
    {
      gid: 813708013,
      path: 'foo/different-gid-nouid/bar',
      type: 'File',
      size: 3
    },
    'qux',
    {
      uid: myUid,
      gid: myGid,
      path: 'foo-mine/',
      type: 'Directory'
    },
    {
      uid: myUid,
      gid: myGid,
      path: 'foo-mine/bar',
      type: 'File',
      size: 3
    },
    'qux',
    {
      uid: myUid,
      path: 'foo-mine/nogid',
      type: 'Directory'
    },
    {
      uid: myUid,
      path: 'foo-mine/nogid/bar',
      type: 'File',
      size: 3
    },
    'qux',
    '',
    ''
  ])

  t.test('chown failure results in unpack failure', t => {
    const dir = path.resolve(unpackdir, 'chown')
    const poop = new Error('expected chown failure')
    const un = mutateFS.fail('chown', poop)
    const unl = mutateFS.fail('lchown', poop)
    const unf = mutateFS.fail('fchown', poop)

    t.teardown(_ => (un(), unf(), unl()))

    t.test('sync', t => {
      mkdirp.sync(dir)
      t.teardown(_ => rimraf.sync(dir))
      let warned = false
      const u = new Unpack.Sync({
        cwd: dir,
        preserveOwner: true,
        onwarn: (m, er) => {
          if (!warned) {
            warned = true
            t.equal(er, poop)
            t.end()
          }
        }
      })
      u.end(data)
    })

    t.test('async', t => {
      mkdirp.sync(dir)
      t.teardown(_ => rimraf.sync(dir))
      let warned = false
      const u = new Unpack({
        cwd: dir,
        preserveOwner: true,
        onwarn: (m, er) => {
          if (!warned) {
            warned = true
            t.equal(er, poop)
            t.end()
          }
        }
      })
      u.end(data)
    })

    t.test('cleanup', t => {
      rimraf.sync(dir)
      t.end()
    })

    t.end()
  })

  t.test('chown when true', t => {
    const dir = path.resolve(unpackdir, 'chown')
    const chown = fs.chown
    const chownSync = fs.chownSync
    const fchownSync = fs.fchownSync
    let called = 0
    fs.fchown = fs.chown = (path, owner, group, cb) => {
      called ++
      cb()
    }
    fs.chownSync = fs.fchownSync = _ => called++

    t.teardown(_ => {
      fs.chown = chown
      fs.chownSync = chownSync
      fs.fchownSync = fchownSync
    })

    t.test('sync', t => {
      mkdirp.sync(dir)
      t.teardown(_ => rimraf.sync(dir))
      called = 0
      const u = new Unpack.Sync({ cwd: dir, preserveOwner: true })
      u.end(data)
      t.ok(called >= 5, 'called chowns')
      t.end()
    })

    t.test('async', t => {
      mkdirp.sync(dir)
      t.teardown(_ => rimraf.sync(dir))
      called = 0
      const u = new Unpack({ cwd: dir, preserveOwner: true })
      u.end(data)
      u.on('close', _ => {
        t.ok(called >= 5, 'called chowns')
        t.end()
      })
    })

    t.end()
  })

  t.test('no chown when false', t => {
    const dir = path.resolve(unpackdir, 'nochown')
    const poop = new Error('poop')
    const un = mutateFS.fail('chown', poop)
    const unf = mutateFS.fail('fchown', poop)
    const unl = mutateFS.fail('lchown', poop)
    t.teardown(_ => {
      rimraf.sync(dir)
      un()
      unf()
      unl()
    })

    t.beforeEach(cb => mkdirp(dir, cb))
    t.afterEach(cb => rimraf(dir, cb))

    const check = t => {
      const dirStat = fs.statSync(dir + '/foo')
      t.notEqual(dirStat.uid, 2456124561)
      t.notEqual(dirStat.gid, 813708013)
      const fileStat = fs.statSync(dir + '/foo/my-uid-different-gid')
      t.notEqual(fileStat.uid, 2456124561)
      t.notEqual(fileStat.gid, 813708013)
      const dirStat2 = fs.statSync(dir + '/foo/different-uid-nogid')
      t.notEqual(dirStat2.uid, 2456124561)
      const fileStat2 = fs.statSync(dir + '/foo/different-uid-nogid/bar')
      t.notEqual(fileStat2.uid, 2456124561)
      t.end()
    }

    t.test('sync', t => {
      const u = new Unpack.Sync({ cwd: dir, preserveOwner: false })
      u.end(data)
      check(t)
    })

    t.test('async', t => {
      const u = new Unpack({ cwd: dir, preserveOwner: false })
      u.end(data)
      u.on('close', _ => check(t))
    })

    t.end()
  })

  t.end()
})

t.test('unpack when dir is not writable', t => {
  const data = makeTar([
    {
      path: 'a/',
      type: 'Directory',
      mode: 0o444
    },
    {
      path: 'a/b',
      type: 'File',
      size: 1
    },
    'a',
    '',
    ''
  ])

  const dir = path.resolve(unpackdir, 'nowrite-dir')
  t.beforeEach(cb => mkdirp(dir, cb))
  t.afterEach(cb => rimraf(dir, cb))

  const check = t => {
    t.equal(fs.statSync(dir + '/a').mode & 0o7777, 0o744)
    t.equal(fs.readFileSync(dir + '/a/b', 'utf8'), 'a')
    t.end()
  }

  t.test('sync', t => {
    const u = new Unpack.Sync({ cwd: dir, strict: true })
    u.end(data)
    check(t)
  })

  t.test('async', t => {
    const u = new Unpack({ cwd: dir, strict: true })
    u.end(data)
    u.on('close', _ => check(t))
  })

  t.end()
})

t.test('transmute chars on windows', t => {
  const data = makeTar([
    {
      path: '<|>?:.txt',
      size: 5,
      type: 'File'
    },
    '<|>?:',
    '',
    ''
  ])

  const dir = path.resolve(unpackdir, 'winchars')
  t.beforeEach(cb => mkdirp(dir, cb))
  t.afterEach(cb => rimraf(dir, cb))

  const hex = 'ef80bcef81bcef80beef80bfef80ba2e747874'
  const uglyName = Buffer.from(hex, 'hex').toString()
  const ugly = path.resolve(dir, uglyName)

  const check = t => {
    t.same(fs.readdirSync(dir), [ uglyName ])
    t.equal(fs.readFileSync(ugly, 'utf8'), '<|>?:')
    t.end()
  }

  t.test('async', t => {
    const u = new Unpack({
      cwd: dir,
      win32: true
    })
    u.end(data)
    u.on('close', _ => check(t))
  })

  t.test('sync', t => {
    const u = new Unpack.Sync({
      cwd: dir,
      win32: true
    })
    u.end(data)
    check(t)
  })

  t.end()
})

t.test('safely transmute chars on windows with absolutes', t => {
  // don't actually make the directory
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('mkdir', poop))

  const data = makeTar([
    {
      path: 'c:/x/y/z/<|>?:.txt',
      size: 5,
      type: 'File'
    },
    '<|>?:',
    '',
    ''
  ])

  const hex = 'ef80bcef81bcef80beef80bfef80ba2e747874'
  const uglyName = Buffer.from(hex, 'hex').toString()
  const uglyPath = 'c:/x/y/z/' + uglyName

  const u = new Unpack({
    win32: true,
    preservePaths: true
  })
  u.on('entry', entry => {
    t.equal(entry.path, uglyPath)
    t.end()
  })

  u.end(data)
})

t.test('use explicit chmod when required by umask', t => {
  process.umask(0o022)

  const basedir = path.resolve(unpackdir, 'umask-chmod')

  const data = makeTar([
    {
      path: 'x/y/z',
      mode: 0o775,
      type: 'Directory'
    },
    '',
    ''
  ])

  const check = t => {
    const st = fs.statSync(basedir + '/x/y/z')
    t.equal(st.mode & 0o777, 0o775)
    rimraf.sync(basedir)
    t.end()
  }

  t.test('async', t => {
    mkdirp.sync(basedir)
    const unpack = new Unpack({ cwd: basedir })
    unpack.on('close', _ => check(t))
    unpack.end(data)
  })

  return t.test('sync', t => {
    mkdirp.sync(basedir)
    const unpack = new Unpack.Sync({ cwd: basedir })
    unpack.end(data)
    check(t)
  })
})

t.test('chown implicit dirs and also the entries', t => {
  const basedir = path.resolve(unpackdir, 'chownr')

  // club these so that the test can run as non-root
  const chown = fs.chown
  const chownSync = fs.chownSync
  const lchown = fs.lchown
  const lchownSync = fs.lchownSync
  const fchown = fs.fchown
  const fchownSync = fs.fchownSync

  const getuid = process.getuid
  const getgid = process.getgid
  t.teardown(_ => {
    fs.chown = chown
    fs.chownSync = chownSync
    fs.lchown = lchown
    fs.lchownSync = lchownSync
    fs.fchown = fchown
    fs.fchownSync = fchownSync
    process.getgid = getgid
  })

  let chowns = 0

  let currentTest = null
  fs.fchown = fs.chown = (path, uid, gid, cb) => {
    currentTest.equal(uid, 420, 'chown(' + path + ') uid')
    currentTest.equal(gid, 666, 'chown(' + path + ') gid')
    chowns ++
    cb()
  }
  if (fs.lchown)
    fs.lchown = fs.fchown

  fs.chownSync = fs.fchownSync = (path, uid, gid) => {
    currentTest.equal(uid, 420, 'chownSync(' + path + ') uid')
    currentTest.equal(gid, 666, 'chownSync(' + path + ') gid')
    chowns ++
  }
  if (fs.lchownSync)
    fs.lchownSync = fs.fchownSync

  const data = makeTar([
    {
      path: 'a/b/c',
      mode: 0o775,
      type: 'File',
      size: 1,
      uid: null,
      gid: null
    },
    '.',
    {
      path: 'x/y/z',
      mode: 0o775,
      uid: 12345,
      gid: 54321,
      type: 'File',
      size: 1
    },
    '.',
    '',
    ''
  ])

  const check = t => {
    currentTest = null
    t.equal(chowns, 8)
    chowns = 0
    rimraf.sync(basedir)
    t.end()
  }

  t.test('throws when setting uid/gid improperly', t => {
    t.throws(_ => new Unpack({ uid: 420 }),
      TypeError('cannot set owner without number uid and gid'))
    t.throws(_ => new Unpack({ gid: 666 }),
      TypeError('cannot set owner without number uid and gid'))
    t.throws(_ => new Unpack({ uid: 1, gid: 2, preserveOwner: true }),
      TypeError('cannot preserve owner in archive and also set owner explicitly'))
    t.end()
  })

  const tests = () =>
    t.test('async', t => {
      currentTest = t
      mkdirp.sync(basedir)
      const unpack = new Unpack({ cwd: basedir, uid: 420, gid: 666 })
      unpack.on('close', _ => check(t))
      unpack.end(data)
    }).then(t.test('sync', t => {
      currentTest = t
      mkdirp.sync(basedir)
      const unpack = new Unpack.Sync({ cwd: basedir, uid: 420, gid: 666 })
      unpack.end(data)
      check(t)
    }))

  tests()

  t.test('make it look like processUid is 420', t => {
    process.getuid = () => 420
    t.end()
  })

  tests()

  t.test('make it look like processGid is 666', t => {
    process.getuid = getuid
    process.getgid = () => 666
    t.end()
  })

  return tests()
})

t.test('bad cwd setting', t => {
  const basedir = path.resolve(unpackdir, 'bad-cwd')
  mkdirp.sync(basedir)
  t.teardown(_ => rimraf.sync(basedir))

  const cases = [
    // the cwd itself
    {
      path: './',
      type: 'Directory'
    },
    // a file directly in the cwd
    {
      path: 'a',
      type: 'File'
    },
    // a file nested within a subdir of the cwd
    {
      path: 'a/b/c',
      type: 'File'
    }
  ]

  fs.writeFileSync(basedir + '/file', 'xyz')

  cases.forEach(c => t.test(c.type + ' ' + c.path, t => {
    const data = makeTar([
      {
        path: c.path,
        mode: 0o775,
        type: c.type,
        size: 0,
        uid: null,
        gid: null
      },
      '',
      ''
    ])

    t.test('cwd is a file', t => {
      const cwd = basedir + '/file'
      const opt = { cwd: cwd }

      t.throws(_ => new Unpack.Sync(opt).end(data), {
        name: 'CwdError',
        message: 'ENOTDIR: Cannot cd into \'' + cwd + '\'',
        path: cwd,
        code: 'ENOTDIR'
      })

      new Unpack(opt).on('error', er => {
        t.match(er, {
          name: 'CwdError',
          message: 'ENOTDIR: Cannot cd into \'' + cwd + '\'',
          path: cwd,
          code: 'ENOTDIR'
        })
        t.end()
      }).end(data)
    })

    return t.test('cwd is missing', t => {
      const cwd = basedir + '/asdf/asdf/asdf'
      const opt = { cwd: cwd }

      t.throws(_ => new Unpack.Sync(opt).end(data), {
        name: 'CwdError',
        message: 'ENOENT: Cannot cd into \'' + cwd + '\'',
        path: cwd,
        code: 'ENOENT'
      })

      new Unpack(opt).on('error', er => {
        t.match(er, {
          name: 'CwdError',
          message: 'ENOENT: Cannot cd into \'' + cwd + '\'',
          path: cwd,
          code: 'ENOENT'
        })
        t.end()
      }).end(data)
    })
  }))

  t.end()
})

t.test('transform', t => {
  const basedir = path.resolve(unpackdir, 'transform')
  t.teardown(_ => rimraf.sync(basedir))

  const cases = {
    'emptypax.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'one-byte.txt': '[a]'
    },
    'body-byte-counts.tar': {
      '1024-bytes.txt': new Array(1024).join('[x]') + '[\n]',
      '512-bytes.txt': new Array(512).join('[x]') + '[\n]',
      'one-byte.txt': '[a]',
      'zero-byte.txt': ''
    },
    'utf8.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'Ω.txt': '[Ω]',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': '[Ω]'
    }
  }

  const txFn = entry => {
    switch (path.basename(entry.path)) {
      case 'zero-bytes.txt':
        return entry

      case 'one-byte.txt':
      case '1024-bytes.txt':
      case '512-bytes.txt':
      case 'Ω.txt':
        return new Bracer()
    }
  }

  class Bracer extends MiniPass {
    write (data) {
      const d = data.toString().split('').map(c => '[' + c + ']').join('')
      return super.write(d)
    }
  }

  const tarfiles = Object.keys(cases)
  t.plan(tarfiles.length)
  t.jobs = tarfiles.length

  tarfiles.forEach(tarfile => {
    t.test(tarfile, t => {
      const tf = path.resolve(tars, tarfile)
      const dir = path.resolve(basedir, tarfile)
      t.beforeEach(cb => {
        rimraf.sync(dir)
        mkdirp.sync(dir)
        cb()
      })

      const check = t => {
        const expect = cases[tarfile]
        Object.keys(expect).forEach(file => {
          const f = path.resolve(dir, file)
          t.equal(fs.readFileSync(f, 'utf8'), expect[file], file)
        })
        t.end()
      }

      t.plan(2)

      t.test('async unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new Unpack({ cwd: dir, strict: true, transform: txFn })
          fs.createReadStream(tf).pipe(unpack)
          eos(unpack, _ => check(t))
        })
        t.test('loose', t => {
          const unpack = new Unpack({ cwd: dir, transform: txFn })
          fs.createReadStream(tf).pipe(unpack)
          eos(unpack, _ => check(t))
        })
      })

      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new UnpackSync({ cwd: dir, strict: true, transform: txFn })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
        t.test('loose', t => {
          const unpack = new UnpackSync({ cwd: dir, transform: txFn })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
      })
    })
  })
})

t.test('transform error', t => {
  const dir = path.resolve(unpackdir, 'transform-error')
  mkdirp.sync(dir)
  t.teardown(_ => rimraf.sync(dir))

  const tarfile = path.resolve(tars, 'body-byte-counts.tar')
  const tardata = fs.readFileSync(tarfile)
  const poop = new Error('poop')

  const txFn = () => {
    const tx = new MiniPass()
    tx.write = () => tx.emit('error', poop)
    tx.resume()
    return tx
  }

  t.test('sync unpack', t => {
    t.test('strict', t => {
      const unpack = new UnpackSync({ cwd: dir, strict: true, transform: txFn })
      const expect = 3
      let actual = 0
      unpack.on('error', er => {
        t.equal(er, poop)
        actual ++
      })
      unpack.end(tardata)
      t.equal(actual, expect, 'error count')
      t.end()
    })
    t.test('loose', t => {
      const unpack = new UnpackSync({ cwd: dir, transform: txFn })
      const expect = 3
      let actual = 0
      unpack.on('warn', (msg, er) => {
        t.equal(er, poop)
        actual ++
      })
      unpack.end(tardata)
      t.equal(actual, expect, 'error count')
      t.end()
    })
    t.end()
  })
  t.test('async unpack', t => {
    // the last error is about the folder being deleted, just ignore that one
    t.test('strict', t => {
      const unpack = new Unpack({ cwd: dir, strict: true, transform: txFn })
      t.plan(3)
      t.teardown(() => {
        unpack.removeAllListeners('error')
        unpack.on('error', () => {})
      })
      unpack.on('error', er => t.equal(er, poop))
      unpack.end(tardata)
    })
    t.test('loose', t => {
      const unpack = new Unpack({ cwd: dir, transform: txFn })
      t.plan(3)
      t.teardown(() => unpack.removeAllListeners('warn'))
      unpack.on('warn', (msg, er) => t.equal(er, poop))
      unpack.end(tardata)
    })
    t.end()
  })

  t.end()
})

t.test('futimes/fchown failures', t => {
  const archive = path.resolve(tars, 'utf8.tar')
  const dir = path.resolve(unpackdir, 'futimes-fchown-fails')
  const tardata = fs.readFileSync(archive)

  const poop = new Error('poop')
  const second = new Error('second error')

  const reset = cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
  }

  reset()
  t.teardown(() => rimraf.sync(dir))

  const methods = ['utimes', 'chown']
  methods.forEach(method => {
    const fc = method === 'chown'
    t.test(method +' fallback', t => {
      t.teardown(mutateFS.fail('f' + method, poop))
      // forceChown will fail on systems where the user is not root
      // and/or the uid/gid in the archive aren't valid. We're just
      // verifying coverage here, so make the method auto-pass.
      t.teardown(mutateFS.pass(method))
      t.plan(2)
      t.test('async unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          reset()
          const unpack = new Unpack({ cwd: dir, strict: true, forceChown: fc })
          unpack.on('finish', t.end)
          unpack.end(tardata)
        })
        t.test('loose', t => {
          reset()
          const unpack = new Unpack({ cwd: dir, forceChown: fc })
          unpack.on('finish', t.end)
          unpack.on('warn', t.fail)
          unpack.end(tardata)
        })
      })
      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          reset()
          const unpack = new Unpack.Sync({ cwd: dir, strict: true, forceChown: fc })
          unpack.end(tardata)
          t.end()
        })
        t.test('loose', t => {
          reset()
          const unpack = new Unpack.Sync({ cwd: dir, forceChown: fc })
          unpack.on('warn', t.fail)
          unpack.end(tardata)
          t.end()
        })
      })
    })

    t.test('also fail ' + method, t => {
      const unmutate = mutateFS.fail('f' + method, poop)
      const unmutate2 = mutateFS.fail(method, second)
      t.teardown(() => {
        unmutate()
        unmutate2()
      })
      t.plan(2)
      t.test('async unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          reset()
          const unpack = new Unpack({ cwd: dir, strict: true, forceChown: fc })
          t.plan(3)
          unpack.on('error', er => t.equal(er, poop))
          unpack.end(tardata)
        })
        t.test('loose', t => {
          reset()
          const unpack = new Unpack({ cwd: dir, forceChown: fc })
          t.plan(3)
          unpack.on('warn', (m, er) => t.equal(er, poop))
          unpack.end(tardata)
        })
      })
      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          reset()
          const unpack = new Unpack.Sync({ cwd: dir, strict: true, forceChown: fc })
          t.plan(3)
          unpack.on('error', er => t.equal(er, poop))
          unpack.end(tardata)
        })
        t.test('loose', t => {
          reset()
          const unpack = new Unpack.Sync({ cwd: dir, forceChown: fc })
          t.plan(3)
          unpack.on('warn', (m, er) => t.equal(er, poop))
          unpack.end(tardata)
        })
      })
    })
  })

  t.end()
})

t.test('onentry option is preserved', t => {
  const basedir = path.resolve(unpackdir, 'onentry-method')
  mkdirp.sync(basedir)
  t.teardown(() => rimraf.sync(basedir))

  let oecalls = 0
  const onentry = entry => oecalls++
  const data = makeTar([
    {
      path: 'd/i',
      type: 'Directory'
    },
    {
      path: 'd/i/r/dir',
      type: 'Directory',
      mode: 0o751,
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z')
    },
    'a',
    '',
    ''
  ])

  const check = t => {
    t.equal(oecalls, 3)
    oecalls = 0
    t.end()
  }

  t.test('sync', t => {
    const dir = path.join(basedir, 'sync')
    mkdirp.sync(dir)
    const unpack = new UnpackSync({ cwd: dir, onentry })
    unpack.end(data)
    check(t)
  })

  t.test('async', t => {
    const dir = path.join(basedir, 'async')
    mkdirp.sync(dir)
    const unpack = new Unpack({ cwd: dir, onentry })
    unpack.on('finish', () => check(t))
    unpack.end(data)
  })

  t.end()
})

t.test('do not reuse hardlinks, only nlink=1 files', t => {
  const basedir = path.resolve(unpackdir, 'hardlink-reuse')
  mkdirp.sync(basedir)
  t.teardown(() => rimraf.sync(basedir))

  const now = new Date('2018-04-30T18:30:39.025Z')

  const data = makeTar([
    {
      path: 'overwriteme',
      type: 'File',
      size: 4,
      mode: 0o644,
      mtime: now
    },
    'foo\n',
    {
      path: 'link',
      linkpath: 'overwriteme',
      type: 'Link',
      mode: 0o644,
      mtime: now
    },
    {
      path: 'link',
      type: 'File',
      size: 4,
      mode: 0o644,
      mtime: now
    },
    'bar\n',
    '',
    ''
  ])

  const checks = {
    'link': 'bar\n',
    'overwriteme': 'foo\n'
  }

  const check = t => {
    for (let f in checks) {
      t.equal(fs.readFileSync(basedir + '/' + f, 'utf8'), checks[f], f)
      t.equal(fs.statSync(basedir + '/' + f).nlink, 1, f)
    }
    t.end()
  }

  t.test('async', t => {
    const u = new Unpack({ cwd: basedir })
    u.on('close', () => check(t))
    u.end(data)
  })

  t.test('sync', t => {
    const u = new UnpackSync({ cwd: basedir })
    u.end(data)
    check(t)
  })

  t.end()
})

t.test('drop entry from dirCache if no longer a directory', t => {
  const dir = path.resolve(unpackdir, 'dir-cache-error')
  mkdirp.sync(dir + '/sync/y')
  mkdirp.sync(dir + '/async/y')
  const data = makeTar([
    {
      path: 'x',
      type: 'Directory',
    },
    {
      path: 'x',
      type: 'SymbolicLink',
      linkpath: './y',
    },
    {
      path: 'x/ginkoid',
      type: 'File',
      size: 'ginkoid'.length,
    },
    'ginkoid',
    '',
    '',
  ])
  t.plan(2)
  const WARNINGS = {}
  const check = (t, path) => {
    t.equal(fs.statSync(path + '/x').isDirectory(), true)
    t.equal(fs.lstatSync(path + '/x').isSymbolicLink(), true)
    t.equal(fs.statSync(path + '/y').isDirectory(), true)
    t.strictSame(fs.readdirSync(path + '/y'), [])
    t.throws(() => fs.readFileSync(path + '/x/ginkoid'), { code: 'ENOENT' })
    t.strictSame(WARNINGS[path], [
      'Cannot extract through symbolic link',
    ])
    t.end()
  }
  t.test('async', t => {
    const path = dir + '/async'
    new Unpack({ cwd: path })
      .on('warn', (msg) => WARNINGS[path] = [msg])
      .on('end', () => check(t, path))
      .end(data)
  })
  t.test('sync', t => {
    const path = dir + '/sync'
    new UnpackSync({ cwd: path })
      .on('warn', (msg) => WARNINGS[path] = [msg])
      .end(data)
    check(t, path)
  })
})

// Emulate a filesystem where two different names refer to the same
// directory entry (unicode normalization on macOS, 8.3 short names on
// windows), so that the dirCache poisoning can be exercised anywhere.
// When a symlink is created at a name that aliases an existing (empty)
// directory, the directory is replaced by the symlink, just like the
// lstat + rmdir + symlink sequence would do on such a filesystem.
const aliasingSymlinks = (t, alias) => {
  const symlink = fs.symlink
  const symlinkSync = fs.symlinkSync
  const replace = dest => {
    const real = alias(dest)
    if (real !== dest) {
      try {
        fs.rmdirSync(real)
      } catch (er) {}
    }
    return real
  }
  fs.symlink = (target, dest, cb) => symlink(target, replace(dest), cb)
  fs.symlinkSync = (target, dest) => symlinkSync(target, replace(dest))
  t.teardown(_ => {
    fs.symlink = symlink
    fs.symlinkSync = symlinkSync
  })
}

// café, in NFC and NFD forms
const cafeNFC = 'café'
const cafeNFD = 'café'

t.test('dirCache pruning unicode normalized collisions', {
  skip: isWindows && 'symlinks not fully supported',
}, t => {
  const data = makeTar([
    {
      type: 'Directory',
      path: 'foo',
    },
    {
      type: 'File',
      path: 'foo/bar',
      size: 1,
    },
    'x',
    {
      type: 'Directory',
      path: cafeNFC,
    },
    {
      type: 'SymbolicLink',
      path: cafeNFD,
      linkpath: 'foo',
    },
    {
      type: 'Directory',
      path: 'foo',
    },
    {
      type: 'File',
      path: cafeNFC + '/bar',
      size: 1,
    },
    'y',
    '',
    '',
  ])

  const basedir = path.resolve(unpackdir, 'dircache-unicode')
  t.teardown(_ => rimraf.sync(basedir))

  // on a unicode-normalizing filesystem, the NFD symlink replaces the
  // NFC directory, leaving a stale dirCache entry for it.
  aliasingSymlinks(t, p => p.normalize('NFC'))

  const check = (t, cwd, snapshot, warnings) => {
    // the symlink entry blew away all the dirCache entries before it
    t.strictSame(snapshot.filter(k => k !== cwd), [])
    t.equal(fs.lstatSync(cwd + '/' + cafeNFC).isSymbolicLink(), true)
    // and so the write through the symlink was refused
    t.equal(fs.readFileSync(cwd + '/foo/bar', 'utf8'), 'x')
    t.strictSame(warnings, ['Cannot extract through symbolic link'])
    t.end()
  }

  const setup = (u, dirCache, snapshot, warnings) => u
    .on('warn', msg => warnings.push(msg))
    .on('entry', entry => {
      if (entry.type === 'SymbolicLink')
        Array.from(dirCache.keys()).forEach(k => snapshot.push(k))
    })

  t.test('sync', t => {
    const cwd = path.resolve(basedir, 'sync')
    mkdirp.sync(cwd)
    const dirCache = new Map()
    const snapshot = []
    const warnings = []
    setup(new UnpackSync({ cwd, dirCache }), dirCache, snapshot, warnings)
      .end(data)
    check(t, cwd, snapshot, warnings)
  })

  t.test('async', t => {
    const cwd = path.resolve(basedir, 'async')
    mkdirp.sync(cwd)
    const dirCache = new Map()
    const snapshot = []
    const warnings = []
    setup(new Unpack({ cwd, dirCache }), dirCache, snapshot, warnings)
      .on('close', _ => check(t, cwd, snapshot, warnings))
      .end(data)
  })

  t.end()
})

t.test('dirCache dropped for any symlink, not just colliding names', {
  skip: isWindows && 'symlinks not fully supported',
}, t => {
  // a windows 8.3 short name aliases its long name, but there is no way
  // to know that by looking at the names, so any symlink has to drop
  // the whole cache.
  // The link target stays inside cwd, because a linkpath that walks out of
  // the extraction target with '..' is refused outright, and such an entry
  // would never get as far as the dirCache at all.
  const data = makeTar([
    {
      type: 'Directory',
      path: 'foobarbazquux',
    },
    {
      type: 'SymbolicLink',
      path: 'FOOBAR~1',
      linkpath: './elsewhere',
    },
    {
      type: 'File',
      path: 'foobarbazquux/pwned',
      size: 1,
    },
    'z',
    {
      type: 'File',
      path: 'bar/baz',
      size: 1,
    },
    'b',
    '',
    '',
  ])

  const basedir = path.resolve(unpackdir, 'dircache-any-symlink')
  t.teardown(_ => rimraf.sync(basedir))

  aliasingSymlinks(t, p => p.replace(/\/FOOBAR~1$/, '/foobarbazquux'))

  const check = (t, cwd, elsewhere, dirCache, snapshot, warnings) => {
    // the symlink entry blew away all the dirCache entries before it
    t.strictSame(snapshot.filter(k => k !== cwd), [])
    t.equal(fs.lstatSync(cwd + '/foobarbazquux').isSymbolicLink(), true)
    // nothing was written through the symlink
    t.strictSame(fs.readdirSync(elsewhere), [])
    t.strictSame(warnings, ['Cannot extract through symbolic link'])
    t.equal(fs.readFileSync(cwd + '/bar/baz', 'utf8'), 'b')
    t.strictSame(Array.from(dirCache.keys()).sort(), [cwd, cwd + '/bar'])
    t.end()
  }

  const setup = (u, dirCache, snapshot, warnings) => u
    .on('warn', msg => warnings.push(msg))
    .on('entry', entry => {
      if (entry.type === 'SymbolicLink')
        Array.from(dirCache.keys()).forEach(k => snapshot.push(k))
    })

  t.test('sync', t => {
    const cwd = path.resolve(basedir, 'sync/cwd')
    const elsewhere = path.resolve(cwd, 'elsewhere')
    mkdirp.sync(cwd)
    mkdirp.sync(elsewhere)
    const dirCache = new Map()
    const snapshot = []
    const warnings = []
    setup(new UnpackSync({ cwd, dirCache }), dirCache, snapshot, warnings)
      .end(data)
    check(t, cwd, elsewhere, dirCache, snapshot, warnings)
  })

  t.test('async', t => {
    const cwd = path.resolve(basedir, 'async/cwd')
    const elsewhere = path.resolve(cwd, 'elsewhere')
    mkdirp.sync(cwd)
    mkdirp.sync(elsewhere)
    const dirCache = new Map()
    const snapshot = []
    const warnings = []
    setup(new Unpack({ cwd, dirCache }), dirCache, snapshot, warnings)
      .on('close', _ =>
        check(t, cwd, elsewhere, dirCache, snapshot, warnings))
      .end(data)
  })

  t.end()
})

t.test('dirCache pruned for unicode and case variants of a name', t => {
  // ﬁle, with the ﬁ ligature, is FILE with NFKD normalization
  const data = makeTar([
    {
      type: 'Directory',
      path: cafeNFC,
    },
    {
      type: 'Directory',
      path: cafeNFC + '/sub',
    },
    {
      type: 'Directory',
      path: 'ﬁle',
    },
    {
      type: 'File',
      path: cafeNFD.toUpperCase(),
      size: 1,
    },
    'z',
    {
      type: 'File',
      path: 'FILE',
      size: 1,
    },
    'f',
    '',
    '',
  ])

  const basedir = path.resolve(unpackdir, 'dircache-prune-unicode')
  t.teardown(_ => rimraf.sync(basedir))

  const check = (t, cwd, dirCache) => {
    // the files pruned the directories and their children from the cache
    t.strictSame(Array.from(dirCache.keys()), [cwd])
    t.end()
  }

  t.test('sync', t => {
    const cwd = path.resolve(basedir, 'sync')
    mkdirp.sync(cwd)
    const dirCache = new Map()
    new UnpackSync({ cwd, dirCache }).end(data)
    check(t, cwd, dirCache)
  })

  t.test('async', t => {
    const cwd = path.resolve(basedir, 'async')
    mkdirp.sync(cwd)
    const dirCache = new Map()
    new Unpack({ cwd, dirCache })
      .on('close', _ => check(t, cwd, dirCache))
      .end(data)
  })

  t.end()
})

// a windows extraction target on a drive that none of the attack vectors
// name, so path.win32.resolve() of a raw entry path always lands outside it
const winTarget = 'E:\\safety\\land'

// document *why* a raw entry path is dangerous: on windows it resolves
// somewhere other than inside the extraction target.
const assertEscapes = (t, raw) => {
  const resolved = path.win32.resolve(winTarget, raw).toLowerCase()
  const target = winTarget.toLowerCase()
  t.ok(resolved !== target && resolved.indexOf(target + '\\') !== 0,
    raw + ' resolves to ' + resolved + ', outside ' + winTarget)
}

const driveRelativeTar = p => makeTar([
  {
    path: p,
    type: 'File',
    size: 1,
    mode: 0o644,
    mtime: new Date('2011-03-27T22:16:31.000Z'),
  },
  'x',
  '',
  '',
])

const driveRelativeCheck = (t, c, legdir, warnings) => {
  const cwd = path.resolve(legdir, 'cwd')
  assertEscapes(t, c.raw)
  t.strictSame(warnings, [c.warning], 'warned about ' + c.raw)
  if (c.lands === null)
    t.strictSame(fs.readdirSync(cwd), [], 'nothing was extracted')
  else {
    t.strictSame(fs.readdirSync(cwd), [c.lands.split('/')[0]],
      'only the sanitized entry was created')
    t.equal(fs.readFileSync(path.resolve(cwd, c.lands), 'utf8'), 'x',
      'entry body landed at ' + c.lands)
  }
  t.strictSame(fs.readdirSync(legdir), ['cwd'],
    'nothing written beside the extraction target')
  t.end()
}

// CVE-2021-37713: on windows a path like 'c:../foo', 'c:foo' or 'C:some\path'
// is NOT absolute, but it does have a root, so path.resolve() resolves it
// against the current directory of *that drive* instead of against the
// extraction target -- letting an archive write wherever it likes.  The '..'
// check missed the 'c:..' spelling too, because the '..' is glued onto the
// drive letter and so is not a path part of its own.  The drive root has to
// come off the entry path, and the '..' check has to see what is left.
t.test('drive-relative paths', t => {
  const dir = path.resolve(unpackdir, 'drive-relative')
  t.teardown(_ => rimraf.sync(dir))

  const cases = [
    // the advisory's 'c:../foo' vector, in its posix-separator spelling
    {
      raw: 'c:../system/explorer.exe',
      warning: ['path contains \'..\'', 'c:../system/explorer.exe'],
      lands: null,
    },
    // guard: this one has a bare '..' part, so it was already caught
    {
      raw: 'd:../../unsafe/land',
      warning: ['path contains \'..\'', 'd:../../unsafe/land'],
      lands: null,
    },
    // 'c:..' is a single path part, so a plain '..' check never sees it
    {
      raw: 'c:..',
      warning: ['path contains \'..\'', 'c:..'],
      lands: null,
    },
    // no '..' at all, but the drive root still has to come off
    {
      raw: 'c:foo',
      warning: ['stripping c: from absolute path', 'c:foo'],
      lands: 'foo',
    },
    {
      raw: 'D:mark',
      warning: ['stripping D: from absolute path', 'D:mark'],
      lands: 'mark',
    },
    // a drive-relative root hiding behind an absolute one: stripping only
    // the leading '/' leaves 'c:../foo/bar', which escapes all over again
    {
      raw: '/c:../foo/bar',
      warning: ['path contains \'..\'', '/c:../foo/bar'],
      lands: null,
    },
    // windows thinks //x/y is the "root" of //x/y/z/a, but that is a made up
    // host and share, so the whole thing is kept, minus the separators
    {
      raw: '//x/y/z/a',
      warning: ['stripping // from absolute path', '//x/y/z/a'],
      lands: 'x/y/z/a',
    },
    // '//?/X:/' is a real root and must be taken off whole, rather than
    // one leading '/' at a time
    {
      raw: '//?/X:/y/z',
      warning: ['stripping //?/X:/ from absolute path', '//?/X:/y/z'],
      lands: 'y/z',
    },
  ]

  const setup = leg => {
    const legdir = path.resolve(dir, leg)
    rimraf.sync(legdir)
    mkdirp.sync(path.resolve(legdir, 'cwd'))
    return legdir
  }

  cases.forEach((c, i) => t.test(c.raw, t => {
    const data = driveRelativeTar(c.raw)

    t.test('async', t => {
      const legdir = setup(i + '-async')
      const warnings = []
      new Unpack({
        cwd: path.resolve(legdir, 'cwd'),
        onwarn: (w, d) => warnings.push([w, d]),
      }).on('close', _ => driveRelativeCheck(t, c, legdir, warnings))
        .end(data)
    })

    t.test('sync', t => {
      const legdir = setup(i + '-sync')
      const warnings = []
      new UnpackSync({
        cwd: path.resolve(legdir, 'cwd'),
        onwarn: (w, d) => warnings.push([w, d]),
      }).end(data)
      driveRelativeCheck(t, c, legdir, warnings)
    })

    t.end()
  }))

  t.end()
})

// CVE-2021-37713: the advisory spells its vectors with backslashes
// ('C:some\path', 'c:..\system\explorer.exe'), which are only directory
// separators on windows.  Fake the platform so normalize-windows-path turns
// them into '/', and check the drive root still comes off and the '..' is
// still caught.
t.test('drive-relative paths with \\ separators', {
  skip: isWindows && 'fake platform test, run on posix',
}, t => {
  const dir = path.resolve(unpackdir, 'drive-relative-win32')

  const cases = [
    // the advisory's 'C:some\path' vector
    {
      raw: 'C:some\\foo',
      warning: ['stripping C: from absolute path', 'C:some/foo'],
      lands: 'some/foo',
    },
    // the advisory's 'c:..\foo' vector
    {
      raw: 'c:..\\system\\explorer.exe',
      warning: ['path contains \'..\'', 'c:../system/explorer.exe'],
      lands: null,
    },
    // guard: a plainly absolute windows path was stripped before the fix too
    {
      raw: 'D:\\unsafe\\land',
      warning: ['stripping D:/ from absolute path', 'D:/unsafe/land'],
      lands: 'unsafe/land',
    },
  ]

  // build the archives with the real posix Header, before faking the platform
  const datas = cases.map(c => driveRelativeTar(c.raw))

  // swap the faked platform in and re-require the library with a cleared
  // cache, since normalize-windows-path.js reads the platform at load time.
  const libdir = path.resolve(__dirname, '..', 'lib') + path.sep
  const reload = platform => {
    if (platform)
      process.env.TESTING_TAR_FAKE_PLATFORM = platform
    else
      delete process.env.TESTING_TAR_FAKE_PLATFORM
    Object.keys(require.cache)
      .filter(k => k.indexOf(libdir) === 0)
      .forEach(k => delete require.cache[k])
    return require('../lib/unpack.js')
  }

  t.teardown(_ => {
    rimraf.sync(dir)
    reload(null)
  })

  const setup = leg => {
    const legdir = path.resolve(dir, leg)
    rimraf.sync(legdir)
    mkdirp.sync(path.resolve(legdir, 'cwd'))
    return legdir
  }

  cases.forEach((c, i) => t.test(c.raw, t => {
    t.test('async', t => {
      const WinUnpack = reload('win32')
      const legdir = setup(i + '-async')
      const warnings = []
      new WinUnpack({
        cwd: path.resolve(legdir, 'cwd'),
        onwarn: (w, d) => warnings.push([w, d]),
      }).on('close', _ => driveRelativeCheck(t, c, legdir, warnings))
        .end(datas[i])
    })

    t.test('sync', t => {
      const WinUnpackSync = reload('win32').Sync
      const legdir = setup(i + '-sync')
      const warnings = []
      new WinUnpackSync({
        cwd: path.resolve(legdir, 'cwd'),
        onwarn: (w, d) => warnings.push([w, d]),
      }).end(datas[i])
      driveRelativeCheck(t, c, legdir, warnings)
    })

    t.end()
  }))

  t.end()
})

// CVE-2024-28863: a single tar entry can name a path nested hundreds of
// thousands of levels deep.  Unpacking it means an mkdir per level, so one
// 450kb archive is enough to keep the process (and the file system) busy for
// a very long time.  Anything deeper than maxDepth is warned about and
// skipped instead, and nothing is written for it at all.
t.test('excessively deep subfolder nesting', t => {
  const dir = path.resolve(unpackdir, 'excessively-deep')
  t.teardown(_ => rimraf.sync(dir))

  const tf = path.resolve(fixtures, 'excessively-deep.tar')
  const data = fs.readFileSync(tf)
  const warnings = []
  const onwarn = (msg, d) => warnings.push([msg, d])

  const setup = leg => {
    const cwd = path.resolve(dir, leg)
    rimraf.sync(cwd)
    mkdirp.sync(cwd)
    return cwd
  }

  const check = (t, cwd, maxDepth) => {
    maxDepth = maxDepth === undefined ? 1024 : maxDepth
    t.equal(warnings.length, 1,
      'exactly one warning, got: ' + warnings.map(w => w[0]).join(' | '))
    const w = warnings[0] || []
    t.equal(w[0], 'TAR_ENTRY_ERROR')
    const d = w[1] || {}
    t.ok(d.entry instanceof ReadEntry, 'the offending entry is reported')
    t.match(d.path, /^\.(\/a){1024,}\/foo\.txt$/, 'the offending path')
    t.equal(d.depth, 222372, 'the depth of the entry')
    t.equal(d.depth, String(d.path).split('/').length,
      'depth is the path depth')
    t.ok(d.depth > maxDepth, 'the reported depth is over the limit')
    t.equal(d.maxDepth, maxDepth, 'the limit that was exceeded')
    t.strictSame(fs.readdirSync(cwd), [],
      'nothing at all is created in the extraction target')
    warnings.length = 0
    t.end()
  }

  t.test('async', t => {
    const cwd = setup('async')
    new Unpack({
      cwd: cwd,
      onwarn: onwarn,
    }).on('end', () => check(t, cwd)).end(data)
  })

  t.test('sync', t => {
    const cwd = setup('sync')
    new UnpackSync({
      cwd: cwd,
      onwarn: onwarn,
    }).end(data)
    check(t, cwd)
  })

  t.test('async set md', t => {
    const cwd = setup('async-set-md')
    new Unpack({
      cwd: cwd,
      onwarn: onwarn,
      maxDepth: 64,
    }).on('end', () => check(t, cwd, 64)).end(data)
  })

  t.test('sync set md', t => {
    const cwd = setup('sync-set-md')
    new UnpackSync({
      cwd: cwd,
      onwarn: onwarn,
      maxDepth: 64,
    }).end(data)
    check(t, cwd, 64)
  })

  t.test('depth up to maxDepth is unpacked, one past it is not', t => {
    const shallow = makeTar([
      {
        path: 'a/b/c.txt',
        type: 'File',
        size: 1,
      },
      'x',
      {
        path: 'a/b/c/d.txt',
        type: 'File',
        size: 1,
      },
      'y',
      '',
      '',
    ])

    const checkLimit = (t, cwd) => {
      t.equal(warnings.length, 1, 'one warning for the too-deep entry')
      const w = warnings[0] || []
      t.equal(w[0], 'TAR_ENTRY_ERROR')
      const d = w[1] || {}
      t.equal(d.path, 'a/b/c/d.txt', 'the too-deep entry is reported')
      t.equal(d.depth, 4, 'the depth of the entry')
      t.equal(d.maxDepth, 3, 'the limit that was exceeded')
      t.equal(fs.readFileSync(cwd + '/a/b/c.txt', 'utf8'), 'x',
        'an entry exactly at the limit is unpacked')
      t.notOk(fs.existsSync(cwd + '/a/b/c'),
        'nothing is created for the entry past the limit')
      warnings.length = 0
      t.end()
    }

    t.test('async', t => {
      const cwd = setup('limit-async')
      new Unpack({
        cwd: cwd,
        onwarn: onwarn,
        maxDepth: 3,
      }).on('end', () => checkLimit(t, cwd)).end(shallow)
    })

    t.test('sync', t => {
      const cwd = setup('limit-sync')
      new UnpackSync({
        cwd: cwd,
        onwarn: onwarn,
        maxDepth: 3,
      }).end(shallow)
      checkLimit(t, cwd)
    })

    t.end()
  })

  t.test('maxDepth: Infinity turns the limit off', t => {
    // The limit is opt-out, so `maxDepth: Infinity` has to skip the depth
    // check entirely and leave a normal archive completely untouched.
    const cwd = setup('unlimited')
    const shallow = makeTar([
      {
        path: 'a/b/c.txt',
        type: 'File',
        size: 1,
      },
      'x',
      '',
      '',
    ])
    new Unpack({
      cwd: cwd,
      onwarn: onwarn,
      maxDepth: Infinity,
    }).on('end', () => {
      t.strictSame(warnings, [], 'no depth warning with maxDepth: Infinity')
      t.equal(fs.readFileSync(cwd + '/a/b/c.txt', 'utf8'), 'x',
        'the archive is unpacked as usual')
      warnings.length = 0
      t.end()
    }).end(shallow)
  })

  t.end()
})

// only the warnings about sanitizing a linkpath, and not the ones about
// failing to create a link to wherever the sanitized linkpath points now
const linkpathWarnings = warnings => warnings
  .filter(w => /^stripping .* from absolute linkpath$|^linkpath /.test(w[0]))

// CVE-2026-23745 (GHSA-8qq5-rm4j-mr97): only the entry path used to be
// checked for '..' and for an absolute root, but the linkpath of a link
// entry lands on the file system just the same.  A hard link's linkpath is
// resolved against the extraction target, so an absolute or '..' linkpath
// links in an arbitrary file from outside of it, which anything writing to
// the extracted link then clobbers.  A symbolic link's linkpath is the target
// of the link, so an absolute one, or one that walks out with '..', points
// outside of the extraction target.
t.test('linkpath is sanitized like the entry path', {
  skip: isWindows && 'symlinks not fully supported',
}, t => {
  const dir = path.resolve(unpackdir, 'linkpath-sanitize')
  t.teardown(_ => rimraf.sync(dir))

  const targetSym = '/some/absolute/path'

  // the absolute path to the secret depends on where the checkout lives, so
  // put a pax header in front of an entry whose linkpath does not fit into
  // the 100 bytes that a plain ustar header has room for.
  const block = chunk => {
    const buf = Buffer.alloc(512)
    if (typeof chunk === 'string') {
      buf.write(chunk)
      return buf
    }
    const header = new Header(chunk)
    header.encode(buf, 0)
    return header.needPax ? Buffer.concat([new Pax(chunk).encode(), buf])
      : buf
  }

  const exploitTar = secret => Buffer.concat([
    {
      path: 'foo/file.txt',
      type: 'File',
      size: 'hello world'.length,
    },
    'hello world',
    // hard links to a file outside of the extraction target
    {
      path: 'exploit_hard',
      type: 'Link',
      linkpath: secret,
    },
    {
      path: 'exploit_hard_dotdot',
      type: 'Link',
      linkpath: '../secret.txt',
    },
    // this would stay inside if it was resolved against the directory the
    // link is in, but hard links are resolved against the extraction target
    {
      path: 'sub/hard_dotdot',
      type: 'Link',
      linkpath: '../secret.txt',
    },
    // symbolic links pointing outside of the extraction target
    {
      path: 'exploit_sym',
      type: 'SymbolicLink',
      linkpath: targetSym,
    },
    {
      path: 'escape_sym',
      type: 'SymbolicLink',
      linkpath: '../secret.txt',
    },
    {
      path: 'sub/deep_escape',
      type: 'SymbolicLink',
      linkpath: '../../escape',
    },
    {
      path: 'up',
      type: 'SymbolicLink',
      linkpath: '..',
    },
    // the drive root comes off first, and leaves a '..' that walks out
    {
      path: 'drive_sym',
      type: 'SymbolicLink',
      linkpath: 'c:../secret.txt',
    },
    // the root comes off first, and what is left stays inside
    {
      path: 'a/link',
      type: 'SymbolicLink',
      linkpath: '/../a/target',
    },
    // a relative symbolic link to a sibling inside the target is just fine
    {
      path: 'bar/link.txt',
      type: 'SymbolicLink',
      linkpath: '../foo/file.txt',
    },
    '',
    '',
  ].map(block))

  const setup = leg => {
    const legdir = path.resolve(dir, leg)
    rimraf.sync(legdir)
    mkdirp.sync(path.resolve(legdir, 'cwd'))
    const secret = path.resolve(legdir, 'secret.txt')
    fs.writeFileSync(secret, 'ORIGINAL DATA')
    return {
      legdir: legdir,
      cwd: path.resolve(legdir, 'cwd'),
      secret: secret,
      data: exploitTar(secret),
    }
  }

  const check = (t, leg, warnings) => {
    const cwd = leg.cwd
    const secret = leg.secret
    t.strictSame(linkpathWarnings(warnings), [
      ['stripping / from absolute linkpath', secret],
      ['linkpath contains \'..\'', '../secret.txt'],
      ['linkpath contains \'..\'', '../secret.txt'],
      ['stripping / from absolute linkpath', targetSym],
      ['linkpath escapes extraction directory', '../secret.txt'],
      ['linkpath escapes extraction directory', '../../escape'],
      ['linkpath escapes extraction directory', '..'],
      ['linkpath escapes extraction directory', 'c:../secret.txt'],
      ['stripping / from absolute linkpath', '/../a/target'],
    ], 'warned about every linkpath that was sanitized')

    // no hard link to the secret was made, so writing to the extracted
    // entries does not clobber it
    t.equal(fs.statSync(secret).nlink, 1, 'no hard link to the secret')
    t.throws(_ => fs.lstatSync(path.resolve(cwd, 'sub/hard_dotdot')),
      { code: 'ENOENT' }, 'hard link resolved against target not created')
    fs.writeFileSync(path.resolve(cwd, 'exploit_hard'), 'OVERWRITTEN')
    fs.writeFileSync(path.resolve(cwd, 'exploit_hard_dotdot'), 'OVERWRITTEN')
    t.equal(fs.readFileSync(secret, 'utf8'), 'ORIGINAL DATA',
      'secret was not clobbered through a hard link')

    // the absolute symbolic link is relative to the extraction target now
    t.equal(fs.readlinkSync(path.resolve(cwd, 'exploit_sym')),
      'some/absolute/path', 'root stripped from absolute symlink')
    t.equal(fs.readlinkSync(path.resolve(cwd, 'a/link')), '../a/target',
      'root stripped from absolute symlink with ..')
    // and the ones that would point outside of it are not created at all
    ;['escape_sym', 'sub/deep_escape', 'up', 'drive_sym'].forEach(f =>
      t.throws(_ => fs.lstatSync(path.resolve(cwd, f)), { code: 'ENOENT' },
        f + ' escaping symlink not created'))

    // a relative symlink that stays inside is extracted as it is
    t.equal(fs.readlinkSync(path.resolve(cwd, 'bar/link.txt')),
      '../foo/file.txt', 'relative symlink kept')
    t.equal(fs.readFileSync(path.resolve(cwd, 'bar/link.txt'), 'utf8'),
      'hello world', 'relative symlink resolves inside the target')

    t.strictSame(fs.readdirSync(leg.legdir).sort(), ['cwd', 'secret.txt'],
      'nothing written beside the extraction target')
    t.end()
  }

  t.test('async', t => {
    const leg = setup('async')
    const warnings = []
    new Unpack({
      cwd: leg.cwd,
      onwarn: (w, d) => warnings.push([w, d]),
    }).on('close', _ => check(t, leg, warnings)).end(leg.data)
  })

  t.test('sync', t => {
    const leg = setup('sync')
    const warnings = []
    new UnpackSync({
      cwd: leg.cwd,
      onwarn: (w, d) => warnings.push([w, d]),
    }).end(leg.data)
    check(t, leg, warnings)
  })

  // preservePaths leaves every linkpath exactly as it is in the archive
  t.test('preservePaths', t => {
    const leg = setup('preserve')
    const cwd = leg.cwd
    const warnings = []
    new UnpackSync({
      cwd: cwd,
      preservePaths: true,
      onwarn: (w, d) => warnings.push([w, d]),
    }).end(leg.data)
    t.strictSame(linkpathWarnings(warnings), [], 'no linkpath warnings')
    t.equal(fs.statSync(leg.secret).nlink, 4, 'hard links made as asked')
    t.equal(fs.readlinkSync(path.resolve(cwd, 'exploit_sym')), targetSym)
    t.equal(fs.readlinkSync(path.resolve(cwd, 'escape_sym')),
      '../secret.txt')
    t.equal(fs.readlinkSync(path.resolve(cwd, 'sub/deep_escape')),
      '../../escape')
    t.equal(fs.readlinkSync(path.resolve(cwd, 'up')), '..')
    t.equal(fs.readlinkSync(path.resolve(cwd, 'drive_sym')),
      'c:../secret.txt')
    t.equal(fs.readlinkSync(path.resolve(cwd, 'a/link')), '/../a/target')
    t.equal(fs.readlinkSync(path.resolve(cwd, 'bar/link.txt')),
      '../foo/file.txt')
    t.end()
  })

  t.end()
})

// CVE-2026-23745: on windows a linkpath can use \ as its separator too, and
// spell its root with a drive letter.  Fake the platform so that
// normalize-windows-path turns them into '/', and check that the linkpath is
// still sanitized.
t.test('linkpath with \\ separators', {
  skip: isWindows && 'fake platform test, run on posix',
}, t => {
  const dir = path.resolve(unpackdir, 'linkpath-win32')

  // build the archive with the real posix Header, before faking the platform
  const data = makeTar([
    {
      path: 'hard',
      type: 'Link',
      linkpath: '..\\secret.txt',
    },
    {
      path: 'drive_sym',
      type: 'SymbolicLink',
      linkpath: 'c:..\\secret.txt',
    },
    {
      path: 'sub/sym',
      type: 'SymbolicLink',
      linkpath: '..\\..\\escape',
    },
    {
      path: 'abs_sym',
      type: 'SymbolicLink',
      linkpath: 'D:\\abs\\target',
    },
    '',
    '',
  ])

  // swap the faked platform in and re-require the library with a cleared
  // cache, since normalize-windows-path.js reads the platform at load time.
  const libdir = path.resolve(__dirname, '..', 'lib') + path.sep
  const reload = platform => {
    if (platform)
      process.env.TESTING_TAR_FAKE_PLATFORM = platform
    else
      delete process.env.TESTING_TAR_FAKE_PLATFORM
    Object.keys(require.cache)
      .filter(k => k.indexOf(libdir) === 0)
      .forEach(k => delete require.cache[k])
    return require('../lib/unpack.js')
  }

  t.teardown(_ => {
    rimraf.sync(dir)
    reload(null)
  })

  const setup = leg => {
    const legdir = path.resolve(dir, leg)
    rimraf.sync(legdir)
    mkdirp.sync(path.resolve(legdir, 'cwd'))
    fs.writeFileSync(path.resolve(legdir, 'secret.txt'), 'ORIGINAL DATA')
    return legdir
  }

  const check = (t, legdir, warnings) => {
    const cwd = path.resolve(legdir, 'cwd')
    t.strictSame(linkpathWarnings(warnings), [
      ['linkpath contains \'..\'', '../secret.txt'],
      ['linkpath escapes extraction directory', 'c:../secret.txt'],
      ['linkpath escapes extraction directory', '../../escape'],
      ['stripping D:/ from absolute linkpath', 'D:/abs/target'],
    ], 'warned about every linkpath that was sanitized')
    t.equal(fs.statSync(path.resolve(legdir, 'secret.txt')).nlink, 1,
      'no hard link to the secret')
    t.strictSame(fs.readdirSync(cwd), ['abs_sym'],
      'only the sanitized symlink was created')
    t.equal(fs.readlinkSync(path.resolve(cwd, 'abs_sym')), 'abs/target',
      'drive root stripped from the symlink')
    t.end()
  }

  t.test('async', t => {
    const WinUnpack = reload('win32')
    const legdir = setup('async')
    const warnings = []
    new WinUnpack({
      cwd: path.resolve(legdir, 'cwd'),
      onwarn: (w, d) => warnings.push([w, d]),
    }).on('close', _ => check(t, legdir, warnings)).end(data)
  })

  t.test('sync', t => {
    const WinUnpackSync = reload('win32').Sync
    const legdir = setup('sync')
    const warnings = []
    new WinUnpackSync({
      cwd: path.resolve(legdir, 'cwd'),
      onwarn: (w, d) => warnings.push([w, d]),
    }).end(data)
    check(t, legdir, warnings)
  })

  t.end()
})

// CVE-2026-29786 (GHSA-qffp-2rhf-9h96): the root of a linkpath comes off
// before the '..' check, but on windows \ is a separator just like /, so in a
// drive-relative linkpath like 'c:..\target.txt' the '..' that is left once
// the root is gone walks out of the extraction target, and a hard link made
// there clobbers whatever it points at when the extracted entry is written
// to.  An archive can be extracted on any platform, so the '..' check looks
// between \ separators too, on posix as well, without faking the platform.
t.test('drive-relative linkpath with \\ separators', {
  skip: isWindows && 'symlinks not fully supported',
}, t => {
  const dir = path.resolve(unpackdir, 'drive-relative-linkpath')
  t.teardown(_ => rimraf.sync(dir))

  const data = makeTar([
    // the advisory's vector, a hard link to a file outside of the target
    {
      path: 'escape.txt',
      type: 'Link',
      linkpath: 'C:../target.txt',
    },
    // the same, spelled with the windows separator
    {
      path: 'hard_bs',
      type: 'Link',
      linkpath: 'c:..\\target.txt',
    },
    {
      path: 'hard_nodrive',
      type: 'Link',
      linkpath: '..\\target.txt',
    },
    // symbolic links that walk out once the drive root comes off
    {
      path: 'sym_bs',
      type: 'SymbolicLink',
      linkpath: 'c:..\\target.txt',
    },
    {
      path: 'sub/sym_deep',
      type: 'SymbolicLink',
      linkpath: 'c:..\\..\\target.txt',
    },
    // the entry path is checked the same way
    {
      path: 'c:..\\file.txt',
      type: 'File',
      size: 1,
    },
    'x',
    // the drive root comes off, and what is left stays inside the target
    // when it is resolved from the directory the link is in
    {
      path: 'a/winrootdotslink',
      type: 'SymbolicLink',
      linkpath: 'c:..\\foo\\bar',
    },
    '',
    '',
  ])

  const setup = leg => {
    const legdir = path.resolve(dir, leg)
    rimraf.sync(legdir)
    mkdirp.sync(path.resolve(legdir, 'cwd'))
    fs.writeFileSync(path.resolve(legdir, 'target.txt'), 'ORIGINAL DATA')
    return legdir
  }

  const check = (t, legdir, warnings) => {
    const cwd = path.resolve(legdir, 'cwd')
    const target = path.resolve(legdir, 'target.txt')

    // what is left of 'c:..\target.txt' once the root is gone points
    // outside of the extraction target on windows
    assertEscapes(t, '..\\target.txt')

    t.strictSame(warnings, [
      ['linkpath contains \'..\'', 'C:../target.txt'],
      ['linkpath contains \'..\'', 'c:..\\target.txt'],
      ['linkpath contains \'..\'', '..\\target.txt'],
      ['linkpath escapes extraction directory', 'c:..\\target.txt'],
      ['linkpath escapes extraction directory', 'c:..\\..\\target.txt'],
      ['path contains \'..\'', 'c:..\\file.txt'],
      ['stripping c: from absolute linkpath', 'c:..\\foo\\bar'],
    ], 'warned about every path and linkpath that was sanitized')

    t.equal(fs.statSync(target).nlink, 1, 'no hard link to the target')
    t.strictSame(fs.readdirSync(cwd), ['a'],
      'only the symlink that stays inside was created')
    t.strictSame(fs.readdirSync(path.resolve(cwd, 'a')), ['winrootdotslink'])
    t.equal(fs.readlinkSync(path.resolve(cwd, 'a/winrootdotslink')),
      '..\\foo\\bar', 'symlink target should have root stripped')

    // writing to the extracted entries does not clobber the target
    ;['escape.txt', 'hard_bs', 'hard_nodrive'].forEach(f =>
      fs.writeFileSync(path.resolve(cwd, f), 'OVERWRITTEN'))
    t.equal(fs.readFileSync(target, 'utf8'), 'ORIGINAL DATA',
      'target was not clobbered through a hard link')

    t.strictSame(fs.readdirSync(legdir).sort(), ['cwd', 'target.txt'],
      'nothing written beside the extraction target')
    t.end()
  }

  t.test('async', t => {
    const legdir = setup('async')
    const warnings = []
    new Unpack({
      cwd: path.resolve(legdir, 'cwd'),
      onwarn: (w, d) => warnings.push([w, d]),
    }).on('close', _ => check(t, legdir, warnings)).end(data)
  })

  t.test('sync', t => {
    const legdir = setup('sync')
    const warnings = []
    new UnpackSync({
      cwd: path.resolve(legdir, 'cwd'),
      onwarn: (w, d) => warnings.push([w, d]),
    }).end(data)
    check(t, legdir, warnings)
  })

  t.end()
})

// CVE-2026-26960 (GHSA-83g3-92jg-28cx): the linkpath of a link entry is only
// checked as a string, but the target of a link is resolved on the file
// system, following any symbolic link that is already there.  A chain of
// symbolic links that each stay inside the extraction target as strings can
// walk out of it on disk, and a hard link or a symbolic link made through it
// then reaches a file outside of the extraction target, which reading or
// writing the extracted link leaks or clobbers.  So no link may be made to
// a target that goes through a symbolic link.
const symlinkErrors = warnings => warnings
  .filter(w => /^TAR_SYMLINK_ERROR/.test(w[0]))

t.test('no linking through a symlink', {
  skip: isWindows && 'symlinks not fully supported',
}, t => {
  const dir = path.resolve(unpackdir, 'no-link-through-symlink')
  t.teardown(_ => rimraf.sync(dir))

  // the chain from the upstream fix, and the one from the advisory.  Every
  // link in them stays inside the extraction target as a string, but on
  // disk a/b/escape is the directory that the extraction target is in.
  const chains = {
    'up/..': [
      {
        type: 'SymbolicLink',
        path: 'a/b/up',
        linkpath: '../..',
        mode: 0o755,
      },
      {
        type: 'SymbolicLink',
        path: 'a/b/escape',
        linkpath: 'up/..',
        mode: 0o755,
      },
    ],
    'c/up/../..': [
      {
        type: 'SymbolicLink',
        path: 'a/b/c/up',
        linkpath: '../..',
        mode: 0o755,
      },
      {
        type: 'SymbolicLink',
        path: 'a/b/escape',
        linkpath: 'c/up/../..',
        mode: 0o755,
      },
    ],
  }
  const types = ['Link', 'SymbolicLink']

  let legs = 0
  const setup = () => {
    const legdir = path.resolve(dir, String(legs++))
    rimraf.sync(legdir)
    mkdirp.sync(path.resolve(legdir, 'x'))
    fs.writeFileSync(path.resolve(legdir, 'exploited-file'),
      'original content')
    return legdir
  }

  const check = (t, legdir, warnings) => {
    const cwd = path.resolve(legdir, 'x')
    const victim = path.resolve(legdir, 'exploited-file')
    t.equal(symlinkErrors(warnings).length, 1,
      'refused to link through a symlink')
    t.throws(_ => fs.lstatSync(path.resolve(cwd, 'exploit')),
      { code: 'ENOENT' }, 'no link made through the symlink chain')
    t.equal(fs.statSync(victim).nlink, 1, 'no hard link to the file outside')
    // the symbolic links of the chain itself are extracted as usual
    t.ok(fs.lstatSync(path.resolve(cwd, 'a/b/escape')).isSymbolicLink(),
      'chain symlink extracted')
    // writing to the extracted entry does not clobber the file outside
    fs.writeFileSync(path.resolve(cwd, 'exploit'), 'pwned')
    t.equal(fs.readFileSync(victim, 'utf8'), 'original content',
      'file outside of the extraction target not clobbered')
    t.strictSame(fs.readdirSync(legdir).sort(), ['exploited-file', 'x'],
      'nothing written beside the extraction target')
    t.end()
  }

  Object.keys(chains).forEach(chain => types.forEach(type => {
    const exploit = makeTar(chains[chain].concat([
      {
        type: type,
        path: 'exploit',
        linkpath: 'a/b/escape/exploited-file',
        mode: 0o755,
      },
      '',
      '',
    ]))

    t.test(chain + ' ' + type, t => {
      t.test('sync', t => {
        const legdir = setup()
        const warnings = []
        new UnpackSync({
          cwd: path.resolve(legdir, 'x'),
          onwarn: (w, d) => warnings.push([w, d]),
        }).end(exploit)
        check(t, legdir, warnings)
      })

      t.test('async', t => {
        const legdir = setup()
        const warnings = []
        new Unpack({
          cwd: path.resolve(legdir, 'x'),
          onwarn: (w, d) => warnings.push([w, d]),
        }).on('close', _ => check(t, legdir, warnings)).end(exploit)
      })

      t.test('sync strict', t => {
        const legdir = setup()
        const warnings = []
        new UnpackSync({
          cwd: path.resolve(legdir, 'x'),
          strict: true,
        }).on('error', er => warnings.push([er.message, er])).end(exploit)
        check(t, legdir, warnings)
      })

      t.test('async strict', t => {
        const legdir = setup()
        const warnings = []
        new Unpack({
          cwd: path.resolve(legdir, 'x'),
          strict: true,
        }).on('error', er => warnings.push([er.message, er]))
          .on('close', _ => check(t, legdir, warnings)).end(exploit)
      })

      t.end()
    })
  }))

  t.end()
})

// The same, with no symlink chain in the archive at all: a symbolic link
// that is already on disk in the extraction target, and points outside of
// it, may not be linked through either.
t.test('no linking through a symlink already on disk', {
  skip: isWindows && 'symlinks not fully supported',
}, t => {
  const dir = path.resolve(unpackdir, 'no-link-through-disk-symlink')
  t.teardown(_ => rimraf.sync(dir))

  const data = makeTar([
    {
      type: 'File',
      path: 'real/file.txt',
      size: 'inside'.length,
    },
    'inside',
    {
      type: 'Link',
      path: 'exploit_hard',
      linkpath: 'x/victim.txt',
    },
    {
      type: 'SymbolicLink',
      path: 'exploit_sym',
      linkpath: 'x/victim.txt',
    },
    // resolved from the directory the symbolic link is in
    {
      type: 'SymbolicLink',
      path: 'sub/exploit_sym',
      linkpath: '../x/victim.txt',
    },
    // links that do not go through a symbolic link are made as usual
    {
      type: 'Link',
      path: 'ok_hard',
      linkpath: 'real/file.txt',
    },
    {
      type: 'SymbolicLink',
      path: 'ok_sym',
      linkpath: 'real/file.txt',
    },
    '',
    '',
  ])

  const setup = leg => {
    const legdir = path.resolve(dir, leg)
    rimraf.sync(legdir)
    const cwd = path.resolve(legdir, 'cwd')
    const outside = path.resolve(legdir, 'outside')
    mkdirp.sync(cwd)
    mkdirp.sync(outside)
    fs.writeFileSync(path.resolve(outside, 'victim.txt'), 'ORIGINAL DATA')
    fs.symlinkSync(outside, path.resolve(cwd, 'x'))
    return {
      legdir: legdir,
      cwd: cwd,
      victim: path.resolve(outside, 'victim.txt'),
    }
  }

  const checkOk = (t, cwd) => {
    t.equal(fs.lstatSync(path.resolve(cwd, 'ok_hard')).ino,
      fs.lstatSync(path.resolve(cwd, 'real/file.txt')).ino,
      'hard link inside the extraction target made')
    t.equal(fs.readlinkSync(path.resolve(cwd, 'ok_sym')), 'real/file.txt',
      'symbolic link inside the extraction target made')
    t.equal(fs.readFileSync(path.resolve(cwd, 'ok_sym'), 'utf8'), 'inside')
  }

  const check = (t, leg, warnings) => {
    const cwd = leg.cwd
    t.strictSame(symlinkErrors(warnings).map(w => w[0]), [
      'TAR_SYMLINK_ERROR: Cannot extract through symbolic link',
      'TAR_SYMLINK_ERROR: Cannot extract through symbolic link',
      'TAR_SYMLINK_ERROR: Cannot extract through symbolic link',
    ], 'refused every link through the symlink')
    ;['exploit_hard', 'exploit_sym', 'sub/exploit_sym'].forEach(f =>
      t.throws(_ => fs.lstatSync(path.resolve(cwd, f)), { code: 'ENOENT' },
        f + ' not made through the symlink'))
    t.equal(fs.statSync(leg.victim).nlink, 1, 'no hard link to the victim')
    ;['exploit_hard', 'exploit_sym', 'sub/exploit_sym'].forEach(f =>
      fs.writeFileSync(path.resolve(cwd, f), 'OVERWRITTEN'))
    t.equal(fs.readFileSync(leg.victim, 'utf8'), 'ORIGINAL DATA',
      'victim not clobbered')
    checkOk(t, cwd)
    t.end()
  }

  t.test('sync', t => {
    const leg = setup('sync')
    const warnings = []
    new UnpackSync({
      cwd: leg.cwd,
      onwarn: (w, d) => warnings.push([w, d]),
    }).end(data)
    check(t, leg, warnings)
  })

  t.test('async', t => {
    const leg = setup('async')
    const warnings = []
    new Unpack({
      cwd: leg.cwd,
      onwarn: (w, d) => warnings.push([w, d]),
    }).on('close', _ => check(t, leg, warnings)).end(data)
  })

  // preservePaths allows unpacking through symbolic links
  const checkPreserve = (t, leg, warnings) => {
    const cwd = leg.cwd
    t.strictSame(symlinkErrors(warnings), [], 'no symlink errors')
    t.equal(fs.statSync(leg.victim).nlink, 2, 'hard link made as asked')
    t.equal(fs.readlinkSync(path.resolve(cwd, 'exploit_sym')), 'x/victim.txt')
    t.equal(fs.readlinkSync(path.resolve(cwd, 'sub/exploit_sym')),
      '../x/victim.txt')
    checkOk(t, cwd)
    t.end()
  }

  t.test('sync preservePaths', t => {
    const leg = setup('sync-preserve')
    const warnings = []
    new UnpackSync({
      cwd: leg.cwd,
      preservePaths: true,
      onwarn: (w, d) => warnings.push([w, d]),
    }).end(data)
    checkPreserve(t, leg, warnings)
  })

  t.test('async preservePaths', t => {
    const leg = setup('async-preserve')
    const warnings = []
    new Unpack({
      cwd: leg.cwd,
      preservePaths: true,
      onwarn: (w, d) => warnings.push([w, d]),
    }).on('close', _ => checkPreserve(t, leg, warnings)).end(data)
  })

  t.end()
})

// The extraction target itself may be a symbolic link, so links to targets
// spelled with './', or to the extraction target itself, are made as usual.
t.test('links in an extraction target that is a symlink', {
  skip: isWindows && 'symlinks not fully supported',
}, t => {
  const dir = path.resolve(unpackdir, 'link-in-symlink-cwd')
  t.teardown(_ => rimraf.sync(dir))

  const data = makeTar([
    {
      type: 'File',
      path: 'file.txt',
      size: 'hello'.length,
    },
    'hello',
    {
      type: 'Link',
      path: 'hard',
      linkpath: './file.txt',
    },
    {
      type: 'SymbolicLink',
      path: 'sym',
      linkpath: './file.txt',
    },
    {
      type: 'SymbolicLink',
      path: 'sub/up',
      linkpath: '..',
    },
    {
      type: 'SymbolicLink',
      path: 'self',
      linkpath: '.',
    },
    '',
    '',
  ])

  const setup = leg => {
    const legdir = path.resolve(dir, leg)
    rimraf.sync(legdir)
    mkdirp.sync(path.resolve(legdir, 'real'))
    fs.symlinkSync(path.resolve(legdir, 'real'), path.resolve(legdir, 'cwd'))
    return path.resolve(legdir, 'cwd')
  }

  const check = (t, cwd, warnings) => {
    t.strictSame(warnings, [], 'no warnings')
    t.equal(fs.lstatSync(path.resolve(cwd, 'hard')).ino,
      fs.lstatSync(path.resolve(cwd, 'file.txt')).ino, 'hard link made')
    t.equal(fs.readlinkSync(path.resolve(cwd, 'sym')), './file.txt')
    t.equal(fs.readlinkSync(path.resolve(cwd, 'sub/up')), '..')
    t.equal(fs.readlinkSync(path.resolve(cwd, 'self')), '.')
    t.equal(fs.readFileSync(path.resolve(cwd, 'sub/up/sym'), 'utf8'), 'hello')
    t.end()
  }

  t.test('sync', t => {
    const cwd = setup('sync')
    const warnings = []
    new UnpackSync({
      cwd: cwd,
      onwarn: (w, d) => warnings.push([w, d]),
    }).end(data)
    check(t, cwd, warnings)
  })

  t.test('async', t => {
    const cwd = setup('async')
    const warnings = []
    new Unpack({
      cwd: cwd,
      onwarn: (w, d) => warnings.push([w, d]),
    }).on('close', _ => check(t, cwd, warnings)).end(data)
  })

  t.end()
})

// CVE-2026-59871: the type of a pax header value used to be guessed from the
// shape of the value, so a path made up only of digits -- '12345', a perfectly
// ordinary file name -- came back as the Number 12345 instead of the string it
// is.  Every field of the entry it overrides is then the wrong type, and the
// unpacker does string work on it: the entry blows up on
// `this.path.substr is not a function` and never reaches the disk at all.
t.test('numeric pax/entry name discernment', t => {
  const base = path.resolve(unpackdir, 'numeric-pax-name')
  t.teardown(_ => rimraf.sync(base))

  const numericName = '12345'
  const alphaName = 'abcde'
  const body = '12345\n'
  const names = [numericName, alphaName]
  const stricts = [true, false]

  const setup = leg => {
    const cwd = path.resolve(base, leg)
    rimraf.sync(cwd)
    mkdirp.sync(cwd)
    return cwd
  }

  const tarData = (paxName, entryName) => makeTar([
    new Pax({
      path: paxName,
      size: body.length
    }, false).encode(),
    {
      type: 'File',
      path: entryName,
      mode: 0o755,
      ctime: new Date('2000-01-01T00:00:00.000Z'),
      mtime: new Date('2000-01-01T00:00:00.000Z'),
      size: body.length
    },
    body,
    '',
    '',
    // makeTar sizes the concatenation by the number of chunks it was handed,
    // but an encoded pax header is two blocks from a single chunk -- one more
    // chunk keeps both trailing EOF blocks from being clipped off the end
    ''
  ])

  const check = (t, cwd, paxName) => {
    t.equal(fs.readFileSync(path.resolve(cwd, paxName), 'utf8'), body,
      'the pax path was used as the string it is')
  }

  stricts.forEach(strict => {
    t.test('strict=' + strict, t => {
      names.forEach(paxName => {
        t.test('paxName=' + paxName, t => {
          names.forEach(entryName => {
            t.test('entryName=' + entryName, t => {
              const data = tarData(paxName, entryName)
              const leg = strict + '-' + paxName + '-' + entryName

              t.test('sync', t => {
                const cwd = setup(leg + '-sync')
                new UnpackSync({ strict: strict, cwd: cwd }).end(data)
                check(t, cwd, paxName)
                t.end()
              })

              t.test('async', t => {
                const cwd = setup(leg + '-async')
                new Unpack({ strict: strict, cwd: cwd })
                  .on('close', _ => {
                    check(t, cwd, paxName)
                    t.end()
                  })
                  .end(data)
              })

              t.end()
            })
          })
          t.end()
        })
      })
      t.end()
    })
  })

  t.end()
})

// CVE-2026-59871: a pax path of '0' is made up only of digits as well.  Read
// as the Number 0 it is falsy, so it was dropped altogether, and the entry
// landed on the path in its plain header rather than on the one the pax
// header gave it -- a different file than every other tar extracts.
t.test('pax path of 0 is not dropped in favor of the header path', t => {
  const base = path.resolve(unpackdir, 'zero-pax-name')
  t.teardown(_ => rimraf.sync(base))

  const body = 'zero\n'
  const data = makeTar([
    new Pax({
      path: '0',
      size: body.length
    }, false).encode(),
    {
      type: 'File',
      path: 'abcde',
      mode: 0o644,
      mtime: new Date('2000-01-01T00:00:00.000Z'),
      size: body.length
    },
    body,
    '',
    '',
    ''
  ])

  const setup = leg => {
    const cwd = path.resolve(base, leg)
    rimraf.sync(cwd)
    mkdirp.sync(cwd)
    return cwd
  }

  const check = (t, cwd) => {
    t.equal(fs.readFileSync(path.resolve(cwd, '0'), 'utf8'), body,
      'the entry was written to the pax path')
    t.throws(_ => fs.statSync(path.resolve(cwd, 'abcde')),
      'the header path was not used')
    t.end()
  }

  t.test('sync', t => {
    const cwd = setup('sync')
    new UnpackSync({ cwd: cwd }).end(data)
    check(t, cwd)
  })

  t.test('async', t => {
    const cwd = setup('async')
    new Unpack({ cwd: cwd }).on('close', _ => check(t, cwd)).end(data)
  })

  t.end()
})

t.test('max decompression ratio', t => {
  const zlib = require('zlib')
  const size = 8 * 1024 * 1024
  // NB: make-tar.js truncates every chunk to a single 512 byte block, so the
  // bomb payload has to be concatenated onto the header blocks by hand.
  const data = zlib.gzipSync(Buffer.concat([
    makeTar([
      {
        path: 'bomb',
        size: size,
        type: 'File'
      }
    ]),
    Buffer.alloc(size),
    makeTar(['', ''])
  ]))

  const dir = path.resolve(unpackdir, 'decompression-bomb')
  // each case gets its own cwd, since an aborted unpack may still be
  // flushing out what it had already read when the next case starts
  const setup = name => {
    const cwd = path.resolve(dir, name)
    mkdirp.sync(cwd)
    return cwd
  }
  t.teardown(_ => rimraf.sync(dir))

  t.test('aborts compressed bombs by default', t => {
    t.plan(2)
    const errors = []
    new Unpack({ cwd: setup('async') })
      .on('error', er => {
        errors.push(er)
        if (errors.length === 1)
          t.match(er, {
            message: /^max decompression ratio exceeded: /
          }, 'async aborts')
      })
      .end(data)

    t.throws(_ => new UnpackSync({ cwd: setup('sync') }).end(data), {
      message: /^max decompression ratio exceeded: /
    }, 'sync throws')
  })

  t.test('bounds what reaches the disk', t => {
    const cwd = setup('bounded')
    const ratio = 10
    const errors = []
    new UnpackSync({ cwd: cwd, maxDecompressionRatio: ratio })
      .on('error', er => errors.push(er))
      .end(data)
    t.match(errors[0], {
      message: /^max decompression ratio exceeded: /
    }, 'aborted')
    const written = fs.statSync(path.resolve(cwd, 'bomb')).size
    t.ok(written <= ratio * data.length,
         'wrote no more than ratio * compressed size (' + written + ')')
    t.ok(written < size, 'did not unpack the whole payload')
    t.end()
  })

  t.test('can be disabled explicitly', t => {
    const cwd = setup('disabled')
    const u = new Unpack({ cwd: cwd, maxDecompressionRatio: Infinity })
    u.on('error', er => t.fail(er.message))
    u.on('close', _ => {
      t.equal(fs.statSync(path.resolve(cwd, 'bomb')).size, size,
              'unpacked the entire payload')
      t.end()
    })
    u.end(data)
  })

  t.end()
})
