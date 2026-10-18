import { registerAuth } from './auth.js';
import { registerUsers } from './users.js';
import { registerStreams } from './streams.js';
import { registerSystem } from './system.js';
import { registerWall } from './wall.js';

export function registerRoutes(router, app) {
  registerAuth(router, app);
  registerUsers(router, app);
  registerStreams(router, app);
  registerSystem(router, app);
  registerWall(router, app);
}
