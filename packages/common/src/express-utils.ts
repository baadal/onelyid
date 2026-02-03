import express from 'express'

type RouteInfo = {
  path: string;
  methods: string[];
};

export function listExpressRouterRoutes(router: express.Router, basePath = ''): RouteInfo[] {
  const routes: RouteInfo[] = [];
  router.stack.forEach((layer: any) => {
    if (layer.route) {
      routes.push({
        path: basePath + layer.route.path,
        methods: Object.keys(layer.route.methods),
      });
    } else if (layer.name === 'router' && layer.handle.stack) {
      const path = getPathFromRegexp(layer.regexp);
      routes.push(
        ...listExpressRouterRoutes(layer.handle, basePath + path)
      );
    }
  });
  return routes;
}

function getPathFromRegexp(regexp: RegExp): string {
  const match = regexp.toString().match(/\\\/([^\\]+)\\\//);
  return match ? '/' + match[1] : '';
}
