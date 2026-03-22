/**
 * Role-based permissions for project and org actions.
 * Use with role from requireProjectAccess or context.roleMap[projectId].
 */

const ROLES_CAN_RENAME = ["owner", "admin", "project_admin"];
const ROLES_CAN_ARCHIVE = ["owner", "admin"];
const ROLES_OWNER_ONLY = ["owner"];

export function canRenameProject(role: string): boolean {
  return ROLES_CAN_RENAME.includes(role);
}

export function canArchiveProject(role: string): boolean {
  return ROLES_CAN_ARCHIVE.includes(role);
}

export function canTransferOrganizationOwnership(role: string): boolean {
  return ROLES_OWNER_ONLY.includes(role);
}
