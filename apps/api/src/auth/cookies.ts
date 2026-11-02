import type { FastifyReply } from 'fastify';
import type { AuthConfig } from '@affiliate-content-os/config';
import { COOKIE_SESSION, COOKIE_TRANSACTION } from './constants.js';

export interface CookieOptions {
  readonly path: string;
  readonly httpOnly: boolean;
  readonly sameSite: 'lax';
  readonly secure: boolean;
  readonly maxAge?: number;
}

export function getTransactionCookieOptions(config: AuthConfig): CookieOptions {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: config.transactionTtlSeconds,
  };
}

export function getTransactionClearCookieOptions(config: AuthConfig): CookieOptions {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
  };
}

export function getSessionCookieOptions(
  config: AuthConfig,
  absoluteExpiresAt: Date,
  now: Date,
): CookieOptions {
  const remainingSeconds = Math.max(
    0,
    Math.floor((absoluteExpiresAt.getTime() - now.getTime()) / 1000),
  );
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: remainingSeconds,
  };
}

export function getSessionClearCookieOptions(config: AuthConfig): CookieOptions {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
  };
}

export function setTransactionCookie(reply: FastifyReply, value: string, config: AuthConfig): void {
  reply.setCookie(COOKIE_TRANSACTION, value, getTransactionCookieOptions(config));
}

export function clearTransactionCookie(reply: FastifyReply, config: AuthConfig): void {
  reply.clearCookie(COOKIE_TRANSACTION, getTransactionClearCookieOptions(config));
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  absoluteExpiresAt: Date,
  config: AuthConfig,
  now: Date,
): void {
  reply.setCookie(COOKIE_SESSION, token, getSessionCookieOptions(config, absoluteExpiresAt, now));
}

export function clearSessionCookie(reply: FastifyReply, config: AuthConfig): void {
  reply.clearCookie(COOKIE_SESSION, getSessionClearCookieOptions(config));
}
