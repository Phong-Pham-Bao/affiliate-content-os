import type { ClockPort } from './ports.js';

export class SystemClock implements ClockPort {
  public now(): Date {
    return new Date();
  }
}
