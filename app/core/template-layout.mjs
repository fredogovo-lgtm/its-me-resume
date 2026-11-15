import {hasSidebarContent} from './canvas-groups.mjs';
const sidebarCategories = new Set(['education', 'skills', 'certificate']);

/** Availability is independent of mode; callers preserve free canvas designs. */
export function sidebarIsAvailable(project) { return Array.isArray(project?.blocks)&&hasSidebarContent(project); }
