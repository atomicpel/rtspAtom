import { registerAuth } from './auth.js';
import { registerUsers } from './users.js';
import { registerComputers } from './computers.js';
import { registerSystem } from './system.js';
import { registerWall } from './wall.js';

export function registerRoutes(router, app) {
  registerAuth(router, app);
  registerUsers(router, app);
  registerComputers(router, app);
  registerSystem(router, app);
  registerWall(router, app);
}
