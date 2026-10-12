'use strict'
// separate file so I stop getting nagged in vim about deprecated API.
const umask = () => process.umask()
module.exports = umask
