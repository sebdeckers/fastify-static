'use strict'

const path = require('path')
const statSync = require('fs').statSync
const { PassThrough } = require('readable-stream')
const glob = require('glob')

const send = require('send')

const fp = require('fastify-plugin')

function fastifyStatic (fastify, opts, next) {
  const error = checkRootPathForErrors(opts.root)
  if (error !== undefined) return next(error)

  const setHeaders = opts.setHeaders

  if (setHeaders !== undefined && typeof setHeaders !== 'function') {
    return next(new TypeError('The `setHeaders` option must be a function'))
  }

  const sendOptions = {
    root: opts.root,
    acceptRanges: opts.acceptRanges,
    cacheControl: opts.cacheControl,
    dotfiles: opts.dotfiles,
    etag: opts.etag,
    extensions: opts.extensions,
    immutable: opts.immutable,
    index: opts.index,
    lastModified: opts.lastModified,
    maxAge: opts.maxAge
  }

  function pumpSendToReply (request, reply, pathname) {
    const stream = send(request.raw, pathname, sendOptions)
    var resolvedFilename
    stream.on('file', function (file) {
      resolvedFilename = file
    })

    const wrap = new PassThrough({
      flush (cb) {
        this.finished = true
        if (reply.res.statusCode === 304) {
          reply.send('')
        }
        cb()
      }
    })

    wrap.getHeader = reply.getHeader.bind(reply)
    wrap.setHeader = reply.header.bind(reply)
    wrap.socket = request.raw.socket
    wrap.finished = false

    Object.defineProperty(wrap, 'filename', {
      get () {
        return resolvedFilename
      }
    })
    Object.defineProperty(wrap, 'statusCode', {
      get () {
        return reply.res.statusCode
      },
      set (code) {
        reply.code(code)
      }
    })

    wrap.on('pipe', function () {
      reply.send(wrap)
    })

    if (setHeaders !== undefined) {
      stream.on('headers', setHeaders)
    }

    stream.on('error', function (err) {
      if (err) {
        if (err.code === 'ENOENT') {
          return reply.callNotFound()
        }
        reply.send(err)
      }
    })

    // we cannot use pump, because send error
    // handling is not compatible
    stream.pipe(wrap)
  }

  if (opts.prefix === undefined) opts.prefix = '/'
  const prefix = opts.prefix[opts.prefix.length - 1] === '/' ? opts.prefix : (opts.prefix + '/')
  // Set the schema hide property if defined in opts or true by default
  const schema = { schema: { hide: typeof opts.schemaHide !== 'undefined' ? opts.schemaHide : true } }

  if (opts.decorateReply !== false) {
    fastify.decorateReply('sendFile', function (filePath) {
      pumpSendToReply(this.request, this, filePath)
    })
  }

  if (opts.serve !== false) {
    if (opts.wildcard === undefined || opts.wildcard === true) {
      fastify.get(prefix + '*', schema, function (req, reply) {
        pumpSendToReply(req, reply, '/' + req.params['*'])
      })
    } else {
      glob(path.join(sendOptions.root, '**/*'), function (err, files) {
        if (err) {
          return next(err)
        }
        for (let file of files) {
          file = file.replace(sendOptions.root.replace(/\\/g, '/'), '')
          const route = (prefix + file).replace(/^\/\//, '/')
          fastify.get(route, schema, function (req, reply) {
            pumpSendToReply(req, reply, '/' + file)
          })

          if (file.match(/index\.html$/)) {
            const route2 = route.replace(/index\.html$/, '')
            fastify.get(route2, schema, function (req, reply) {
              pumpSendToReply(req, reply, '/' + file)
            })
          }
        }
        next()
      })

      // return early to avoid calling next afterwards
      return
    }
  }

  next()
}

function checkRootPathForErrors (rootPath) {
  if (rootPath === undefined) {
    return new Error('"root" option is required')
  }
  if (typeof rootPath !== 'string') {
    return new Error('"root" option must be a string')
  }
  if (path.isAbsolute(rootPath) === false) {
    return new Error('"root" option must be an absolute path')
  }

  var pathStat

  try {
    pathStat = statSync(rootPath)
  } catch (e) {
    return e
  }

  if (pathStat.isDirectory() === false) {
    return new Error('"root" option must point to a directory')
  }
}

module.exports = fp(fastifyStatic, {
  fastify: '>=2.0.0',
  name: 'fastify-static'
})
