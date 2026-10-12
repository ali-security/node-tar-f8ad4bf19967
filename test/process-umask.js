'use strict'
const t = require('tap')
const umask = require('../lib/process-umask.js')
t.equal(umask(), process.umask())
