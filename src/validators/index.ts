// ───────────────────────────────────────────────────────────────────
// Input Validation Functions
// ───────────────────────────────────────────────────────────────────

import type { Response } from 'express'
import { AppError, ValidationError } from '../utils/errors'
import { isValidEmail } from '../utils/helpers'
import CONFIG from '../config'

// ───── Primitives ─────────────────────────────────────────────────

export const validateEmail = (email: any, fieldName = 'Email'): string => {
  if (email === undefined || email === null || email === '') {
    throw new ValidationError(`${fieldName} is required`)
  }
  if (typeof email !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`)
  }
  const trimmed = email.trim().toLowerCase()
  if (trimmed.length > 254) {
    throw new ValidationError(`${fieldName} must be at most 254 characters`)
  }
  if (!isValidEmail(trimmed)) {
    throw new ValidationError(`${fieldName} format is invalid`)
  }
  return trimmed
}

export const validatePassword = (password: any, fieldName = 'Password'): string => {
  if (password === undefined || password === null || password === '') {
    throw new ValidationError(`${fieldName} is required`)
  }
  if (typeof password !== 'string') {
    throw new ValidationError(`${fieldName} must be a string`)
  }
  if (password.length < CONFIG.SECURITY.PASSWORD_MIN_LENGTH) {
    throw new ValidationError(
      `${fieldName} must be at least ${CONFIG.SECURITY.PASSWORD_MIN_LENGTH} characters`,
    )
  }
  if (password.length > 128) {
    throw new ValidationError(`${fieldName} must be at most 128 characters`)
  }
  return password
}

export const validateNewPassword = (password: any, fieldName = 'Password'): string => {
  const pwd = validatePassword(password, fieldName)
  if (!/[A-Za-z]/.test(pwd)) {
    throw new ValidationError(`${fieldName} must contain at least one letter`)
  }
  if (!/\d/.test(pwd)) {
    throw new ValidationError(`${fieldName} must contain at least one digit`)
  }
  if (CONFIG.SECURITY.PASSWORD_REQUIRE_SPECIAL && !/[!@#$%^&*()_+\-={}\[\]:;"'<>,.?/\\|`~]/.test(pwd)) {
    throw new ValidationError(`${fieldName} must contain at least one special character`)
  }
  return pwd
}

export const validateRequired = (value: any, fieldName: string): any => {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(`${fieldName} is required`)
  }
  return value
}

export const validateLength = (
  value: string,
  min: number,
  max: number,
  fieldName: string,
): string => {
  const text = String(value ?? '')
  if (text.length < min || text.length > max) {
    throw new ValidationError(`${fieldName} must be between ${min} and ${max} characters`)
  }
  return text
}

export const validateName = (
  value: any,
  fieldName: string,
  min = 2,
  max = 100,
): string => {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(`${fieldName} is required`)
  }
  const text = String(value).trim()
  if (text.length < min || text.length > max) {
    throw new ValidationError(`${fieldName} must be between ${min} and ${max} characters`)
  }
  if (/^\d+$/.test(text)) {
    throw new ValidationError(`${fieldName} cannot be all digits`)
  }
  if (/[<>{}\\]/.test(text)) {
    throw new ValidationError(`${fieldName} contains disallowed characters`)
  }
  return text
}

export const validateUsername = (
  value: any,
  fieldName = 'Username',
  min = 3,
  max = 30,
): string => {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(`${fieldName} is required`)
  }
  const text = String(value).trim()
  if (text.length < min || text.length > max) {
    throw new ValidationError(`${fieldName} must be between ${min} and ${max} characters`)
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(text)) {
    throw new ValidationError(`${fieldName} may only contain letters, numbers, underscore, dot or hyphen`)
  }
  return text
}

export const validatePhone = (value: any, fieldName = 'Phone'): string => {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(`${fieldName} is required`)
  }
  const text = String(value).trim()
  if (!/^[+]?[0-9 ()\-]{7,20}$/.test(text)) {
    throw new ValidationError(`${fieldName} format is invalid`)
  }
  const digits = text.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) {
    throw new ValidationError(`${fieldName} must contain 7–15 digits`)
  }
  return text
}

export const validateUrl = (value: any, fieldName = 'URL'): string => {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(`${fieldName} is required`)
  }
  const text = String(value).trim()
  try {
    const url = new URL(text)
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new ValidationError(`${fieldName} must use http or https`)
    }
    if (text.length > 2048) {
      throw new ValidationError(`${fieldName} must be at most 2048 characters`)
    }
    return text
  } catch (error: any) {
    if (error instanceof ValidationError) throw error
    throw new ValidationError(`${fieldName} format is invalid`)
  }
}

export const validateHexColor = (value: any, fieldName = 'Color'): string => {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(`${fieldName} is required`)
  }
  const text = String(value).trim()
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text)) {
    throw new ValidationError(`${fieldName} must be a valid hex color (e.g. #6366f1)`)
  }
  return text
}

export const validateDate = (value: any, fieldName = 'Date'): string => {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(`${fieldName} is required`)
  }
  const text = String(value)
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`${fieldName} format is invalid`)
  }
  return text
}

export const validateISODate = (value: any, fieldName = 'Date'): string => {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(`${fieldName} is required`)
  }
  const text = String(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(text)) {
    throw new ValidationError(`${fieldName} must be in YYYY-MM-DD format`)
  }
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`${fieldName} is not a real date`)
  }
  return text
}

export const validateInteger = (
  value: any,
  fieldName: string,
  opts: { min?: number; max?: number } = {},
): number => {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(`${fieldName} is required`)
  }
  const num = Number(value)
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    throw new ValidationError(`${fieldName} must be an integer`)
  }
  if (opts.min !== undefined && num < opts.min) {
    throw new ValidationError(`${fieldName} must be at least ${opts.min}`)
  }
  if (opts.max !== undefined && num > opts.max) {
    throw new ValidationError(`${fieldName} must be at most ${opts.max}`)
  }
  return num
}

export const validateRange = (
  value: any,
  min: number,
  max: number,
  fieldName: string,
): number => {
  const num = Number(value)
  if (!Number.isFinite(num) || num < min || num > max) {
    throw new ValidationError(`${fieldName} must be between ${min} and ${max}`)
  }
  return num
}

export const validatePositiveNumber = (value: any, fieldName: string): number => {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) {
    throw new ValidationError(`${fieldName} must be a non-negative number`)
  }
  return num
}

export const validateEnum = <T extends string>(
  value: any,
  allowedValues: readonly T[],
  fieldName: string,
): T => {
  const normalized = String(value || '').toLowerCase()
  if (!allowedValues.includes(normalized as T)) {
    throw new ValidationError(`${fieldName} must be one of: ${allowedValues.join(', ')}`)
  }
  return normalized as T
}

export const validateOptional = <T>(
  value: any,
  validator: (v: any) => T,
): T | null => {
  if (value === undefined || value === null || value === '') return null
  return validator(value)
}

// ───── Composite ─────────────────────────────────────────────────

export const validateLoginInput = (email: any, password: any) => {
  return {
    email: validateEmail(email),
    password: validateRequired(password, 'Password'),
  }
}

export const validateSignupInput = (email: any, password: any, fullName: any) => {
  return {
    email: validateEmail(email),
    password: validateNewPassword(password),
    full_name: validateName(fullName, 'Full name'),
  }
}

// ───── Express helper ────────────────────────────────────────────

export const respondWithError = (res: Response, error: any, fallbackStatus = 500) => {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code || error.name,
    })
  }
  const message = (error && error.message) ? String(error.message) : 'Internal server error'
  return res.status(fallbackStatus).json({ error: message })
}
