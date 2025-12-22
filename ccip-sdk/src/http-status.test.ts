import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { HttpStatus, isServerError, isTransientHttpStatus } from './http-status.ts'

describe('HttpStatus', () => {
  it('should have correct success status code values', () => {
    assert.equal(HttpStatus.OK, 200)
  })

  it('should have correct client error status code values', () => {
    assert.equal(HttpStatus.BAD_REQUEST, 400)
    assert.equal(HttpStatus.UNAUTHORIZED, 401)
    assert.equal(HttpStatus.FORBIDDEN, 403)
    assert.equal(HttpStatus.NOT_FOUND, 404)
    assert.equal(HttpStatus.TOO_MANY_REQUESTS, 429)
  })

  it('should have correct server error status code values', () => {
    assert.equal(HttpStatus.INTERNAL_SERVER_ERROR, 500)
    assert.equal(HttpStatus.BAD_GATEWAY, 502)
    assert.equal(HttpStatus.SERVICE_UNAVAILABLE, 503)
    assert.equal(HttpStatus.GATEWAY_TIMEOUT, 504)
  })
})

describe('isServerError', () => {
  it('should return true for 5xx status codes', () => {
    assert.equal(isServerError(500), true)
    assert.equal(isServerError(502), true)
    assert.equal(isServerError(503), true)
    assert.equal(isServerError(504), true)
    assert.equal(isServerError(599), true)
  })

  it('should return false for non-5xx status codes', () => {
    assert.equal(isServerError(200), false)
    assert.equal(isServerError(201), false)
    assert.equal(isServerError(400), false)
    assert.equal(isServerError(404), false)
    assert.equal(isServerError(429), false)
    assert.equal(isServerError(499), false)
  })

  it('should return false for status codes >= 600', () => {
    assert.equal(isServerError(600), false)
    assert.equal(isServerError(700), false)
  })
})

describe('isTransientHttpStatus', () => {
  it('should return true for 429 (Too Many Requests)', () => {
    assert.equal(isTransientHttpStatus(429), true)
  })

  it('should return true for 5xx status codes', () => {
    assert.equal(isTransientHttpStatus(500), true)
    assert.equal(isTransientHttpStatus(502), true)
    assert.equal(isTransientHttpStatus(503), true)
    assert.equal(isTransientHttpStatus(504), true)
  })

  it('should return false for success status codes', () => {
    assert.equal(isTransientHttpStatus(200), false)
    assert.equal(isTransientHttpStatus(201), false)
  })

  it('should return false for other 4xx client errors', () => {
    assert.equal(isTransientHttpStatus(400), false)
    assert.equal(isTransientHttpStatus(401), false)
    assert.equal(isTransientHttpStatus(403), false)
    assert.equal(isTransientHttpStatus(404), false)
  })
})
