import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, KeyRound, Search, Shield, ShieldAlert, Users } from 'lucide-react';
import apiClient from './api/axios.js';
import './adminRoleManagement.css';

const pageSize = 10;

function roleIsAdmin(role) {
  return Boolean(role?.is_admin);
}

function formatRoleName(name = '') {
  return String(name).replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatPermissionAction(action = '') {
  const labels = {
    manage_own: 'Edit own',
    verify: 'Approve',
    moderate: 'Approve / moderate',
  };
  return labels[action] || formatRoleName(action);
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '—';
}

export default function AdminRoleManagement() {
  const [roles, setRoles] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [assignedPermissions, setAssignedPermissions] = useState([]);
  const [selectedPermissions, setSelectedPermissions] = useState([]);
  const [roleUsers, setRoleUsers] = useState([]);
  const [userPagination, setUserPagination] = useState({ page: 1, total: 0 });
  const [roleSearch, setRoleSearch] = useState('');
  const [permissionSearch, setPermissionSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [usersLoading, setUsersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const selectedRole = roles.find((role) => String(role.id) === String(selectedRoleId)) || null;
  const isDirty = assignedPermissions.length !== selectedPermissions.length
    || assignedPermissions.some((permission) => !selectedPermissions.includes(permission));

  const loadRolesAndPermissions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [roleResponse, permissionResponse] = await Promise.all([
        apiClient.get('/admin/roles', { params: { page: 1, pageSize: 100 } }),
        apiClient.get('/admin/permissions'),
      ]);
      const nextRoles = roleResponse.data.data;
      setRoles(nextRoles);
      setPermissions(permissionResponse.data.data);
      setSelectedRoleId((current) => (
        nextRoles.some((role) => String(role.id) === String(current))
          ? String(current)
          : String(nextRoles[0]?.id || '')
      ));
    } catch (issue) {
      setError(issue.message || 'Unable to load role and permission records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRolesAndPermissions();
  }, [loadRolesAndPermissions]);

  const loadRolePermissions = useCallback(async (roleId) => {
    if (!roleId) {
      setAssignedPermissions([]);
      setSelectedPermissions([]);
      return;
    }
    setPermissionsLoading(true);
    setError('');
    try {
      const response = await apiClient.get(`/admin/roles/${roleId}/permissions`);
      const current = response.data.data.permission_keys;
      setAssignedPermissions(current);
      setSelectedPermissions(current);
    } catch (issue) {
      setError(issue.message || 'Unable to load this role’s permissions.');
    } finally {
      setPermissionsLoading(false);
    }
  }, []);

  const loadRoleUsers = useCallback(async (roleId, page = 1, q = '') => {
    if (!roleId) return;
    setUsersLoading(true);
    setError('');
    try {
      const response = await apiClient.get(`/admin/roles/${roleId}/users`, {
        params: { page, pageSize, ...(q ? { q } : {}) },
      });
      setRoleUsers(response.data.data);
      setUserPagination(response.data.pagination);
    } catch (issue) {
      setError(issue.message || 'Unable to load users assigned to this role.');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedRoleId) return;
    setUserSearch('');
    setUserPagination({ page: 1, total: 0 });
    loadRolePermissions(selectedRoleId);
    loadRoleUsers(selectedRoleId, 1, '');
  }, [loadRolePermissions, loadRoleUsers, selectedRoleId]);

  const visibleRoles = useMemo(() => {
    const query = roleSearch.trim().toLowerCase();
    return roles.filter((role) => !query
      || role.name.toLowerCase().includes(query)
      || String(role.description || '').toLowerCase().includes(query));
  }, [roles, roleSearch]);

  const permissionsByModule = useMemo(() => {
    const query = permissionSearch.trim().toLowerCase();
    return permissions
      .filter((permission) => !query
        || permission.permission_key.toLowerCase().includes(query)
        || permission.module.toLowerCase().includes(query)
        || permission.action.toLowerCase().includes(query)
        || String(permission.description || '').toLowerCase().includes(query))
      .reduce((groups, permission) => {
        groups[permission.module] ||= [];
        groups[permission.module].push(permission);
        return groups;
      }, {});
  }, [permissions, permissionSearch]);

  function togglePermission(permission) {
    setSelectedPermissions((current) => current.includes(permission)
      ? current.filter((entry) => entry !== permission)
      : [...current, permission]);
  }

  async function savePermissions() {
    if (!selectedRole || roleIsAdmin(selectedRole) || !isDirty) return;
    if (!window.confirm(`Save permission changes for ${selectedRole.name}? These changes take effect immediately for users in this role.`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiClient.patch(`/admin/roles/${selectedRole.id}/permissions`, {
        permission_keys: selectedPermissions,
      });
      setNotice(`Permissions updated for ${selectedRole.name}.`);
      await loadRolePermissions(String(selectedRole.id));
      await loadRolesAndPermissions();
    } catch (issue) {
      setError(issue.message || 'Permission changes could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleRoleStatus(role) {
    const enabling = !Boolean(role.is_active);
    const action = enabling ? 'activate' : 'disable';
    const message = enabling
      ? `Activate the ${role.name} role?`
      : `Disable the ${role.name} role? Users may lose access to this role’s permissions.`;
    if (!window.confirm(message)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiClient.patch(`/admin/roles/${role.id}/status`, { is_active: enabling });
      setNotice(`${role.name} role ${enabling ? 'activated' : 'disabled'}.`);
      await loadRolesAndPermissions();
      if (String(role.id) === selectedRoleId) {
        await loadRolePermissions(String(role.id));
        await loadRoleUsers(String(role.id), userPagination.page, userSearch);
      }
    } catch (issue) {
      setError(issue.message || `This role could not be ${action}d.`);
    } finally {
      setSaving(false);
    }
  }

  function searchUsers(event) {
    event.preventDefault();
    setUserPagination((current) => ({ ...current, page: 1 }));
    loadRoleUsers(selectedRoleId, 1, userSearch.trim());
  }

  const userTotalPages = Math.max(1, Math.ceil(userPagination.total / pageSize));

  return (
    <div className="rm-page">
      <header className="page-heading">
        <div><p className="eyebrow">ACCESS CONTROL</p><h2>Role &amp; Permission Management</h2><p className="muted">Review approved roles, permissions, and role membership.</p></div>
      </header>
      {error && <div className="alert error" role="alert">{error}<button className="dismiss" type="button" onClick={() => setError('')}>Dismiss</button></div>}
      {notice && <div className="alert success" role="status">{notice}<button className="dismiss" type="button" onClick={() => setNotice('')}>Dismiss</button></div>}
      {loading ? <div className="rm-loading"><span className="spinner"/>Loading roles and permissions…</div> : <>
        <div className="rm-layout">
          <aside className="panel rm-role-panel">
            <div className="rm-panel-heading"><div><h3>System roles</h3><span>{roles.length} role records</span></div><Shield size={18}/></div>
            <label className="rm-search"><Search size={15}/><input aria-label="Search roles" placeholder="Search roles" value={roleSearch} onChange={(event) => setRoleSearch(event.target.value)}/></label>
            <div className="rm-role-list">
              {visibleRoles.map((role) => <button type="button" className={`rm-role-item ${String(role.id) === selectedRoleId ? 'selected' : ''}`} key={role.id} onClick={() => setSelectedRoleId(String(role.id))}>
                <span className="rm-role-icon"><Shield size={16}/></span>
                <span className="rm-role-copy"><strong>{role.name}</strong><small>{role.description || 'No description'}</small><span className="rm-role-meta">{Number(role.user_count)} users · {Number(role.permission_count)} permissions</span></span>
                <span className={`rm-status ${role.is_active ? 'enabled' : 'disabled'}`}>{role.is_active ? 'Active' : 'Inactive'}</span>
              </button>)}
              {visibleRoles.length === 0 && <p className="rm-empty">No roles match this search.</p>}
            </div>
            <div className="rm-visitor-note"><span className="rm-status public">Public</span><span>Visitor access is anonymous and is not stored as a database role.</span></div>
          </aside>

          <main className="rm-main">
            {selectedRole ? <>
              <section className="panel rm-role-summary">
                <div className="rm-role-summary-icon"><Shield size={20}/></div>
                <div className="rm-role-summary-copy"><div><h3>{selectedRole.name}</h3>{roleIsAdmin(selectedRole) && <span className="rm-status protected"><ShieldAlert size={12}/> Protected</span>}</div><p>{selectedRole.description || 'No description provided.'}</p><span>{Number(selectedRole.user_count)} assigned users · {Number(selectedRole.permission_count)} configured permissions</span></div>
                {!roleIsAdmin(selectedRole) && <button type="button" className={`button ${selectedRole.is_active ? 'secondary' : ''}`} disabled={saving} onClick={() => toggleRoleStatus(selectedRole)}>{selectedRole.is_active ? 'Disable role' : 'Activate role'}</button>}
              </section>

              <section className="panel rm-permissions-panel">
                <div className="rm-section-heading"><div><h3>Permission matrix</h3><p>Grouped by module and action. Role policy boundaries are enforced by the server.</p></div><span className="rm-count">{permissions.length} permissions</span></div>
                <div className="rm-matrix-tools">
                  <label className="rm-search"><Search size={15}/><input aria-label="Search permissions" placeholder="Search module, action, or permission" value={permissionSearch} onChange={(event) => setPermissionSearch(event.target.value)}/></label>
                  {isDirty && <span className="rm-unsaved">Unsaved changes</span>}
                  {!roleIsAdmin(selectedRole) && <button type="button" className="button" disabled={!isDirty || saving || permissionsLoading} onClick={savePermissions}>{saving ? 'Saving…' : 'Save permissions'}</button>}
                </div>
                {permissionsLoading ? <div className="rm-loading"><span className="spinner"/>Loading permission assignments…</div> : Object.keys(permissionsByModule).length === 0 ? <p className="rm-empty">No permissions match this search.</p> : <div className="rm-matrix">
                  {Object.entries(permissionsByModule).sort(([a], [b]) => a.localeCompare(b)).map(([module, rows]) => <section className="rm-module" key={module}>
                    <h4>{formatRoleName(module)}<span>{rows.length} permissions</span></h4>
                    <div className="rm-permission-table-wrap"><table className="rm-permission-table"><thead><tr><th>Action</th><th>Permission</th><th>Description</th><th>Allowed</th></tr></thead><tbody>
                      {rows.map((permission) => {
                        const checked = selectedPermissions.includes(permission.permission_key);
                        const permitted = Boolean(selectedRole.is_admin)
                          || (permission.assignable_roles.includes(String(selectedRole.name).toLowerCase()) && !permission.critical);
                        return <tr key={permission.id} className={permission.critical ? 'critical' : ''}>
                          <td><span className="rm-action">{formatPermissionAction(permission.action)}</span></td>
                          <td><code>{permission.permission_key}</code>{permission.critical && <span className="rm-critical-label">Protected</span>}</td>
                          <td>{permission.description || '—'}</td>
                          <td><label className={`rm-checkbox ${!permitted || roleIsAdmin(selectedRole) ? 'locked' : ''}`} title={permission.critical ? 'Critical system permission' : !permitted ? 'Not included in this role’s approved security policy' : `Grant ${permission.permission_key}`}><input type="checkbox" checked={checked} disabled={roleIsAdmin(selectedRole) || !permitted || saving} onChange={() => togglePermission(permission.permission_key)}/><span><Check size={12}/></span></label></td>
                        </tr>;
                      })}
                    </tbody></table></div>
                  </section>)}
                </div>}
                {roleIsAdmin(selectedRole) && <p className="rm-protected-note"><ShieldAlert size={14}/> Administrator permissions are protected and cannot be changed here.</p>}
              </section>
            </> : <div className="panel rm-empty-state"><Shield size={24}/><strong>No system roles found</strong></div>}
          </main>
        </div>

        {selectedRole && <section className="panel rm-users-panel">
          <div className="rm-section-heading"><div><h3><Users size={17}/> Users assigned to {selectedRole.name}</h3><p>Database accounts currently linked to this role.</p></div><span className="rm-count">{userPagination.total} users</span></div>
          <form className="rm-user-search" onSubmit={searchUsers}><label className="rm-search"><Search size={15}/><input aria-label="Search assigned users" placeholder="Search name, email, or ID" value={userSearch} onChange={(event) => setUserSearch(event.target.value)}/></label><button className="button secondary" type="submit">Search</button></form>
          {usersLoading ? <div className="rm-loading"><span className="spinner"/>Loading assigned users…</div> : roleUsers.length ? <div className="rm-user-list">{roleUsers.map((user) => <article key={user.id}><div className="rm-user-avatar">{String(user.full_name || '?').slice(0, 1).toUpperCase()}</div><div className="rm-user-info"><strong>{user.full_name}</strong><span>{user.email}</span></div><span className={`pill ${user.status}`}>{user.status}</span><small>Joined {formatDate(user.created_at)}</small><span className="rm-user-id">#{user.id}</span></article>)}</div> : <p className="rm-empty">No users are assigned to this role.</p>}
          {userPagination.total > pageSize &&           <div className="rm-user-pagination"><span>Page {userPagination.page} of {userTotalPages}</span><div><button type="button" aria-label="Previous user page" disabled={usersLoading || userPagination.page <= 1} onClick={() => loadRoleUsers(selectedRole.id, userPagination.page - 1, userSearch)}><ChevronLeft size={16}/></button><button type="button" aria-label="Next user page" disabled={usersLoading || userPagination.page >= userTotalPages} onClick={() => loadRoleUsers(selectedRole.id, userPagination.page + 1, userSearch)}><ChevronRight size={16}/></button></div></div>}
        </section>}
      </>}
    </div>
  );
}
