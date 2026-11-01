import { useEffect, useState } from 'react';
import { Camera, KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import apiClient from './api/axios.js';
import './adminProfile.css';

const passwordInitial = { currentPassword: '', newPassword: '', confirmPassword: '' };

function errorText(error) {
  return error.response?.data?.error || error.message || 'The request could not be completed.';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function actionLabel(value) {
  return String(value || 'account activity').replaceAll('_', ' ').replaceAll('.', ' · ');
}

export default function AdminProfile({ user, onUserChange }) {
  const [profile, setProfile] = useState(null);
  const [activity, setActivity] = useState([]);
  const [edit, setEdit] = useState({ full_name: '', phone: '' });
  const [password, setPassword] = useState(passwordInitial);
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [savedPhoto, setSavedPhoto] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    let imageUrl = '';
    setLoading(true);
    setError('');
    Promise.all([
      apiClient.get('/admin/profile'),
      apiClient.get('/admin/profile/activity'),
      apiClient.get('/admin/profile/photo', { responseType: 'blob' }),
    ]).then(([profileResponse, activityResponse, photoResponse]) => {
      if (!active) return;
      const current = profileResponse.data.data;
      setProfile(current);
      setEdit({ full_name: current.full_name || '', phone: current.phone || '' });
      setActivity(activityResponse.data.data || []);
      if (photoResponse.data?.size) {
        imageUrl = URL.createObjectURL(photoResponse.data);
        setSavedPhoto(imageUrl);
      } else {
        setSavedPhoto('');
      }
    }).catch((issue) => {
      if (active) setError(errorText(issue));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [reloadKey, user.id, user.profilePhotoVersion]);

  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  function choosePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPhotoError('Choose a JPG, PNG, or WebP image.');
      return;
    }
    if (!file.size || file.size > 5 * 1024 * 1024) {
      setPhotoError('Choose a non-empty image no larger than 5 MB.');
      return;
    }
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
    setPhotoError('');
    setNotice('');
  }

  function recordActivity(action, severity = 'info') {
    setActivity((current) => [{
      id: `${action}-${Date.now()}`,
      action,
      entity_type: 'user',
      entity_id: String(profile?.id || user.id),
      severity,
      created_at: new Date().toISOString(),
    }, ...current].slice(0, 20));
  }

  async function saveProfile(event) {
    event.preventDefault();
    setSavingProfile(true);
    setError('');
    setNotice('');
    try {
      const response = await apiClient.patch('/admin/profile', {
        full_name: edit.full_name,
        phone: edit.phone || null,
      });
      const updated = response.data.user;
      setProfile((current) => ({ ...current, ...updated }));
      setEdit({ full_name: updated.full_name || '', phone: updated.phone || '' });
      onUserChange?.((current) => ({
        ...current,
        ...updated,
        name: updated.full_name || current.name,
      }));
      recordActivity('admin.profile_updated');
      setNotice('Profile information saved.');
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setSavingProfile(false);
    }
  }

  async function savePhoto() {
    if (!photo) return;
    setSavingPhoto(true);
    setError('');
    setNotice('');
    setPhotoError('');
    try {
      await apiClient.put('/admin/profile/photo', photo, {
        headers: { 'Content-Type': photo.type },
      });
      setPhoto(null);
      setPhotoPreview('');
      setProfile((current) => ({ ...current, has_profile_photo: true }));
      onUserChange?.((current) => ({ ...current, profilePhotoVersion: Date.now() }));
      recordActivity('admin.profile_photo_updated');
      setNotice('Profile image saved.');
    } catch (issue) {
      setPhotoError(errorText(issue));
    } finally {
      setSavingPhoto(false);
    }
  }

  async function removePhoto() {
    setSavingPhoto(true);
    setError('');
    setNotice('');
    setPhotoError('');
    try {
      await apiClient.delete('/admin/profile/photo');
      setPhoto(null);
      setPhotoPreview('');
      setSavedPhoto('');
      setProfile((current) => ({ ...current, has_profile_photo: false }));
      onUserChange?.((current) => ({ ...current, profilePhotoUrl: '', profilePhotoVersion: Date.now() }));
      recordActivity('admin.profile_photo_removed');
      setNotice('Profile image removed.');
    } catch (issue) {
      setPhotoError(errorText(issue));
    } finally {
      setSavingPhoto(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (password.newPassword !== password.confirmPassword) {
      setError('The new password and confirmation do not match.');
      return;
    }
    setChangingPassword(true);
    try {
      const response = await apiClient.post('/admin/profile/password', {
        currentPassword: password.currentPassword,
        newPassword: password.newPassword,
      });
      setPassword(passwordInitial);
      setNotice(response.data.message || 'Password changed. Other account sessions were signed out.');
      recordActivity('admin.password_changed', 'critical');
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setChangingPassword(false);
    }
  }

  const displayName = profile?.full_name || user.full_name || user.name || 'Administrator';
  const image = photoPreview || savedPhoto;

  return (
    <section className="page admin-profile">
      <div className="page-heading">
        <div>
          <h1>Administrator Profile</h1>
          <p>Manage your personal information, profile image, and account security.</p>
        </div>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      {notice && <div className="alert success" role="status">{notice}</div>}
      {loading ? <div className="admin-profile-state" role="status">Loading your administrator profile…</div> : !profile ? (
        <div className="admin-profile-state">
          <p>Your administrator profile could not be loaded.</p>
          <button className="button secondary" type="button" onClick={() => setReloadKey((current) => current + 1)}>Try again</button>
        </div>
      ) : (
        <div className="admin-profile-layout">
          <div className="admin-profile-main">
            <section className="admin-profile-card">
              <div className="admin-profile-card-heading">
                <div>
                  <h2>Personal information</h2>
                  <p>Your administrator role and account status are managed separately.</p>
                </div>
              </div>
              <form className="admin-profile-form" onSubmit={saveProfile}>
                <div className="admin-profile-identity">
                  <div className="admin-profile-avatar">
                    {image ? <img src={image} alt={`${displayName} profile`} /> : <UserRound size={32}/>}
                  </div>
                  <div className="admin-profile-image-controls">
                    <label className="button secondary admin-profile-file-button">
                      <Camera size={16}/> Choose image
                      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} disabled={savingPhoto}/>
                    </label>
                    <span>JPG, PNG, or WebP · max 5 MB</span>
                    {photo && <button className="button small" type="button" disabled={savingPhoto} onClick={savePhoto}>{savingPhoto ? 'Uploading…' : 'Save image'}</button>}
                    {(photo || profile.has_profile_photo) && <button className="text-action subtle-danger" type="button" disabled={savingPhoto} onClick={removePhoto}>Remove image</button>}
                    {photoError && <span className="admin-profile-photo-error" role="alert">{photoError}</span>}
                  </div>
                </div>
                <div className="admin-profile-fields">
                  <label className="field">
                    <span>Full name</span>
                    <input required minLength={1} maxLength={160} autoComplete="name" value={edit.full_name} onChange={(event) => setEdit((current) => ({ ...current, full_name: event.target.value }))}/>
                  </label>
                  <label className="field">
                    <span>Email address</span>
                    <input type="email" value={profile.email || ''} readOnly aria-readonly="true"/>
                    <small>Email changes require a separate verified workflow.</small>
                  </label>
                  <label className="field">
                    <span>Phone number</span>
                    <input maxLength={40} autoComplete="tel" value={edit.phone} onChange={(event) => setEdit((current) => ({ ...current, phone: event.target.value }))}/>
                  </label>
                </div>
                <button className="button" type="submit" disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save profile'}</button>
              </form>
            </section>

            <section className="admin-profile-card">
              <div className="admin-profile-card-heading">
                <div>
                  <h2><KeyRound size={18}/> Change password</h2>
                  <p>Confirm your current password before choosing a new one.</p>
                </div>
              </div>
              <form className="admin-profile-form" onSubmit={changePassword}>
                <label className="field">
                  <span>Current password</span>
                  <input required type="password" autoComplete="current-password" maxLength={256} value={password.currentPassword} onChange={(event) => setPassword((current) => ({ ...current, currentPassword: event.target.value }))}/>
                </label>
                <div className="admin-profile-fields">
                  <label className="field">
                    <span>New password</span>
                    <input required type="password" autoComplete="new-password" minLength={12} maxLength={16} value={password.newPassword} onChange={(event) => setPassword((current) => ({ ...current, newPassword: event.target.value }))}/>
                  </label>
                  <label className="field">
                    <span>Confirm new password</span>
                    <input required type="password" autoComplete="new-password" minLength={12} maxLength={16} value={password.confirmPassword} onChange={(event) => setPassword((current) => ({ ...current, confirmPassword: event.target.value }))}/>
                  </label>
                </div>
                <p className="admin-profile-hint">Use 12–16 characters with uppercase and lowercase letters and at least one number.</p>
                <button className="button" type="submit" disabled={changingPassword}>{changingPassword ? 'Updating…' : 'Update password'}</button>
              </form>
            </section>
          </div>

          <aside className="admin-profile-side">
            <section className="admin-profile-card">
              <h2><ShieldCheck size={18}/> Account security</h2>
              <dl className="admin-profile-account">
                <dt>Role</dt><dd>{profile.roles || 'Administrator'}</dd>
                <dt>Status</dt><dd><span className={`admin-profile-status ${profile.status}`}>{profile.status}</span></dd>
                <dt>Account created</dt><dd>{formatDate(profile.created_at)}</dd>
                <dt>Account ID</dt><dd>#{profile.id}</dd>
              </dl>
              <p className="admin-profile-security-note">Changing your password signs out other active sessions. Your current session is securely renewed.</p>
            </section>
            <section className="admin-profile-card">
              <h2>Recent account activity</h2>
              {activity.length ? <ol className="admin-profile-activity">
                {activity.map((item) => <li key={item.id}>
                  <span className={`admin-profile-activity-dot ${item.severity || 'info'}`}/>
                  <div>
                    <strong>{actionLabel(item.action)}</strong>
                    <span>{item.entity_type ? `${actionLabel(item.entity_type)}${item.entity_id ? ` #${item.entity_id}` : ''}` : 'Account activity'}</span>
                    <time dateTime={item.created_at}>{formatDate(item.created_at)}</time>
                  </div>
                </li>)}
              </ol> : <p className="admin-profile-empty">No recent account activity is recorded.</p>}
            </section>
          </aside>
        </div>
      )}
    </section>
  );
}
