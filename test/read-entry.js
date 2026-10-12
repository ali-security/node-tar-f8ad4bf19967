'use strict'
const Buffer = require('../lib/buffer.js')
const t = require('tap')
const ReadEntry = require('../lib/read-entry.js')
const Header = require('../lib/header.js')

t.test('create read entry', t => {
  const h = new Header({
    path: 'foo.txt',
    mode: 0o755,
    uid: 24561,
    gid: 20,
    size: 100,
    mtime: new Date('2016-04-01T22:00Z'),
    ctime: new Date('2016-04-01T22:00Z'),
    atime: new Date('2016-04-01T22:00Z'),
    type: 'File',
    uname: 'isaacs',
    gname: 'staff'
  })
  h.encode()

  const entry = new ReadEntry(h, { x: 'y' }, { z: 0, a: null, b: undefined })

  t.ok(entry.header.cksumValid, 'header checksum should be valid')

  t.match(entry, {
    extended: { x: 'y' },
    globalExtended: { z: 0, a: null, b: undefined },
    header: {
      cksumValid: true,
      needPax: false,
      path: 'foo.txt',
      mode: 0o755,
      uid: 24561,
      gid: 20,
      size: 100,
      mtime: new Date('2016-04-01T22:00:00.000Z'),
      typeKey: '0',
      type: 'File',
      linkpath: null,
      uname: 'isaacs',
      gname: 'staff',
      devmaj: 0,
      devmin: 0,
      atime: new Date('2016-04-01T22:00:00.000Z'),
      ctime: new Date('2016-04-01T22:00:00.000Z')
    },
    blockRemain: 512,
    remain: 100,
    type: 'File',
    meta: false,
    ignore: false,
    path: 'foo.txt',
    mode: 0o755,
    uid: 24561,
    gid: 20,
    uname: 'isaacs',
    gname: 'staff',
    size: 100,
    mtime: new Date('2016-04-01T22:00:00.000Z'),
    atime: new Date('2016-04-01T22:00:00.000Z'),
    ctime: new Date('2016-04-01T22:00:00.000Z'),
    linkpath: null,
    x: 'y',
    z: 0
  })

  let data = ''
  let ended = false
  entry.on('data', c => data += c)
  entry.on('end', _ => ended = true)

  const body = Buffer.alloc(512)
  body.write(new Array(101).join('z'), 0)
  entry.write(body)
  entry.end()

  t.equal(data, new Array(101).join('z'))
  t.ok(ended, 'saw end event')

  t.end()
})

t.test('meta entry', t => {
  const h = new Header({
    path: 'PaxHeader/foo.txt',
    mode: 0o755,
    uid: 24561,
    gid: 20,
    size: 23,
    mtime: new Date('2016-04-01T22:00Z'),
    ctime: new Date('2016-04-01T22:00Z'),
    atime: new Date('2016-04-01T22:00Z'),
    type: 'NextFileHasLongLinkpath',
    uname: 'isaacs',
    gname: 'staff'
  })
  const body = Buffer.alloc(512)
  body.write('not that long, actually')

  const expect = 'not that long, actually'
  let actual = ''

  const entry = new ReadEntry(h)
  entry.on('data', c => actual += c)

  entry.write(body.slice(0, 1))
  entry.write(body.slice(1, 25))
  entry.write(body.slice(25))
  t.throws(_=> entry.write(Buffer.alloc(1024)))

  t.equal(actual, expect)
  t.like(entry, { meta: true, type: 'NextFileHasLongLinkpath' })
  t.end()
})

t.test('unknown entry type', t => {
  const h = new Header({
    path: 'PaxHeader/foo.txt',
    mode: 0o755,
    uid: 24561,
    gid: 20,
    size: 23,
    mtime: new Date('2016-04-01T22:00Z'),
    ctime: new Date('2016-04-01T22:00Z'),
    atime: new Date('2016-04-01T22:00Z'),
    uname: 'isaacs',
    gname: 'staff'
  })
  h.encode()
  h.block.write('9', 156, 1, 'ascii')

  const body = Buffer.alloc(512)
  body.write('not that long, actually')

  const expect = ''
  let actual = ''

  const entry = new ReadEntry(new Header(h.block))

  entry.on('data', c => actual += c)

  entry.write(body.slice(0, 1))
  entry.write(body.slice(1, 25))
  entry.write(body.slice(25))
  t.throws(_=> entry.write(Buffer.alloc(1024)))

  t.equal(actual, expect)
  t.like(entry, { ignore: true })
  t.end()
})

t.test('entry without mode', t => {
  const h = new Header({
    path: 'foo.txt',
    uid: 24561,
    gid: 20,
    size: 100,
    mtime: new Date('2016-04-01T22:00Z'),
    ctime: new Date('2016-04-01T22:00Z'),
    atime: new Date('2016-04-01T22:00Z'),
    type: 'File',
    uname: 'isaacs',
    gname: 'staff'
  })
  h.encode()

  const entry = new ReadEntry(h)

  t.ok(entry.header.cksumValid, 'header checksum should be valid')

  t.match(entry, {
    header: {
      cksumValid: true,
      needPax: false,
      path: 'foo.txt',
      mode: null,
      uid: 24561,
      gid: 20,
      size: 100,
      mtime: new Date('2016-04-01T22:00:00.000Z'),
      typeKey: '0',
      type: 'File',
      linkpath: null,
      uname: 'isaacs',
      gname: 'staff',
      devmaj: 0,
      devmin: 0,
      atime: new Date('2016-04-01T22:00:00.000Z'),
      ctime: new Date('2016-04-01T22:00:00.000Z')
    },
    blockRemain: 512,
    remain: 100,
    type: 'File',
    meta: false,
    ignore: false,
    path: 'foo.txt',
    mode: null,
    uid: 24561,
    gid: 20,
    uname: 'isaacs',
    gname: 'staff',
    size: 100,
    mtime: new Date('2016-04-01T22:00:00.000Z'),
    atime: new Date('2016-04-01T22:00:00.000Z'),
    ctime: new Date('2016-04-01T22:00:00.000Z'),
    linkpath: null
  })

  let data = ''
  let ended = false
  entry.on('data', c => data += c)
  entry.on('end', _ => ended = true)

  const body = Buffer.alloc(512)
  body.write(new Array(101).join('z'), 0)
  entry.write(body)
  entry.end()

  t.equal(data, new Array(101).join('z'))
  t.ok(ended, 'saw end event')

  t.end()
})

t.test('do not apply ex/gex to meta entries', t => {
  // CVE-2026-53655: a pending extended header describes the next *file*
  // entry, never an intermediary x/g/L/K/N/X extension header.  Applying a
  // pending pax `size` to a meta entry makes it look bigger than it is,
  // which hides its body behind maxMetaEntrySize.
  const ex = { size: 1024, path: 'smuggled/evil.txt', dev: 5678 }
  const gex = { ino: 9876, uid: 1234 }
  const metaTypes = [
    'NextFileHasLongPath',
    'NextFileHasLongLinkpath',
    'OldGnuLongPath',
    'ExtendedHeader',
    'GlobalExtendedHeader',
    'OldExtendedHeader'
  ]

  metaTypes.forEach(type => {
    const h = new Header({
      path: '././@LongLink',
      type: type,
      uid: 0,
      size: 18
    })
    h.encode()
    const entry = new ReadEntry(new Header(h.block), ex, gex)
    t.equal(entry.meta, true, type + ' is a meta entry')
    t.equal(entry.size, 18, 'expect ' + type + ' to ignore extended size')
    t.equal(entry.remain, 18, 'expect ' + type + ' remain to match header')
    t.equal(entry.path, '././@LongLink',
            'expect ' + type + ' to ignore extended path')
    t.equal(entry.uid, 0, 'expect ' + type + ' to ignore global uid')
    t.equal(entry.dev, undefined, 'expect ' + type + ' to ignore extended dev')
    t.equal(entry.ino, undefined, 'expect ' + type + ' to ignore global ino')
  })

  const fh = new Header({
    path: 'innocent.txt',
    type: 'File',
    uid: 0,
    size: 18
  })
  fh.encode()
  const file = new ReadEntry(new Header(fh.block), ex, gex)
  t.equal(file.meta, false, 'File is not a meta entry')
  t.equal(file.size, 1024, 'File respects extended size')
  t.equal(file.path, 'smuggled/evil.txt', 'File respects extended path')
  t.equal(file.dev, 5678, 'File respects extended dev')
  t.equal(file.uid, 1234, 'File respects global uid')
  t.equal(file.ino, 9876, 'File respects global ino')
  t.end()
})
