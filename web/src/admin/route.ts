export type AdminRoute = 'base' | 'builder';

export function routeFromPath(pathname: string): AdminRoute {
  return pathname.startsWith('/admin/builder') ? 'builder' : 'base';
}
