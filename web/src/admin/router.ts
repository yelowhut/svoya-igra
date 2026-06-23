import { writable } from 'svelte/store';
import { routeFromPath, type AdminRoute } from './route.js';

export const route = writable<AdminRoute>(routeFromPath(location.pathname));

export function navigate(to: AdminRoute): void {
  const path =
    to === 'builder' ? '/admin/builder' :
    to === 'lobby'   ? '/admin/lobby' :
    to === 'pult'    ? '/admin/pult' :
    '/admin/base';
  if (location.pathname !== path) history.pushState({}, '', path);
  route.set(to);
}

export function initRouter(): void {
  window.addEventListener('popstate', () => route.set(routeFromPath(location.pathname)));
}
