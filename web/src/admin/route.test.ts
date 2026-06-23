import { describe, it, expect } from 'vitest';
import { routeFromPath } from './route.js';

describe('routeFromPath', () => {
  it('/admin/builder → builder', () => expect(routeFromPath('/admin/builder')).toBe('builder'));
  it('/admin/base → base', () => expect(routeFromPath('/admin/base')).toBe('base'));
  it('/admin → base (по умолчанию)', () => expect(routeFromPath('/admin')).toBe('base'));
  it('неизвестный путь → base', () => expect(routeFromPath('/admin/whatever')).toBe('base'));
  it('/admin/lobby → lobby', () => expect(routeFromPath('/admin/lobby')).toBe('lobby'));
  it('/admin/pult → pult', () => expect(routeFromPath('/admin/pult')).toBe('pult'));
});
