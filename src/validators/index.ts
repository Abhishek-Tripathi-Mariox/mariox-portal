// ───────────────────────────────────────────────────────────────────
// Input Validation Functions
// ───────────────────────────────────────────────────────────────────

import { ValidationError } from '../utils/errors'
import { isValidEmail } from '../utils/helpers'
import CONFIG from '../config'

/**
 * Validate email
 */
export const validateEmail = (email: any): string => {
  if (!email || typeof email !== 'string') {
    throw new ValidationError('Email is required')
  }
  if (!isValidEmail(email)) {
    throw new ValidationError('Invalid email format')
  }
  return email.toLowerCase().trim()
}

/**
 * Validate password
 */
export const validatePassword = (password: any): string => {
  if (!password || typeof password !== 'string') {
    throw new ValidationError('Password is required')
  }
  if (password.length < CONFIG.SECURITY.PASSWORD_MIN_LENGTH) {
    throw new ValidationError(`Password must be at least ${CONFIG.SECURITY.PASSWORD_MIN_LENGTH} characters`)
  }
  return password
}

/**
 * Validate required field
 */
export const validateRequired = (value: any, fieldName: string): any => {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(`${fieldName} is required`)
  }
  return value
}

/**
 * Validate string length
 */
export const validateLength = (value: string, min: number, max: number, fieldName: string): string => {
  if (value.length < min || value.length > max) {
    throw new ValidationError(`${fieldName} must be between ${min} and ${max} characters`)
  }
  return value
}

/**
 * Validate date
 */
export const validateDate = (date: any): string => {
  if (!date) return ''
  const d = new Date(date)
  if (isNaN(d.getTime())) {
    throw new ValidationError('Invalid date format')
  }
  return date
}

/**
 * Validate number in range
 */
export const validateRange = (value: any, min: number, max: number, fieldName: string): number => {
  const num = Number(value)
  if (isNaN(num) || num < min || num > max) {
    throw new ValidationError(`${fieldName} must be between ${min} and ${max}`)
  }
  return num
}

/**
 * Validate enum value
 */
export const validateEnum = (value: any, allowedValues: string[], fieldName: string): string => {
  if (!allowedValues.includes(value)) {
    throw new ValidationError(`${fieldName} must be one of: ${allowedValues.join(', ')}`)
  }
  return value
}

/**
 * Validate login input
 */
export const validateLoginInput = (email: any, password: any) => {
  return {
    email: validateEmail(email),
    password: validatePassword(password),
  }
}

/**
 * Validate signup input
 */
export const validateSignupInput = (email: any, password: any, fullName: any) => {
  return {
    email: validateEmail(email),
    password: validatePassword(password),
    full_name: validateRequired(fullName, 'Full name'),
  }
}
