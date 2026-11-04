import { useEffect, useState } from 'react';
import { Camera, KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import apiClient from './api/axios.js';
import { translateText } from './language.js';
import './adminProfile.css';

const passwordInitial = { currentPassword: '', newPassword: '', confirmPassword: '' };

function errorText(error) {
  return translateText(error.response?.data?.error || error.message || 'The request could not be completed.');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default function AdminProfile({ user, onUserChange }) {
  const [profile, setProfile] = useState(null);
  const [edit, setEdit] = useState({ full_name: '', phone: '' });
  const [emailDraft, setEmailDraft] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('');
  const [emailOtp, setEmailOtp] = useState('');
  const [emailVerificationSent, setEmailVerificationSent] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState(false);
  const [emailError, setEmailError] = useState('');
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
      apiClient.get('/admin/profile/photo', { responseType: 'blob' }),
    ]).then(([profileResponse, photoResponse]) => {
      if (!active) return;
      const current = profileResponse.data.data;
      setProfile(current);
      setEdit({ full_name: current.full_name || '', phone: current.phone || '' });
      setEmailDraft((draft) => draft || current.email || '');
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
      setNotice('Profile information saved.');
    } catch (issue) {
      setError(errorText(issue));
    } finally {
      setSavingProfile(false);
    }
  }

  async function requestEmailChange(event) {
    event.preventDefault();
    setEmailError('');
    setError('');
    setNotice('');
    const normalizedEmail = emailDraft.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setEmailError(translateText('Enter a valid email address.'));
      return;
    }
    if (normalizedEmail === String(profile.email || '').toLowerCase()) {
      setEmailError(translateText('Enter an email address different from your current address.'));
      return;
    }
    if (!emailCurrentPassword) {
      setEmailError(translateText('Enter your current password to verify this change.'));
      return;
    }

    setChangingEmail(true);
    try {
      const response = await apiClient.post('/admin/profile/email-change', {
        email: normalizedEmail,
        currentPassword: emailCurrentPassword,
      });
      setEmailCurrentPassword('');
      setPendingEmail(normalizedEmail);
      setEmailVerificationSent(true);
      setEmailOtp('');
      setNotice(translateText(response.data.message || 'A verification code was sent to your new email address.'));
    } catch (issue) {
      setEmailError(errorText(issue));
    } finally {
      setChangingEmail(false);
    }
  }

  async function verifyEmailChange(event) {
    event.preventDefault();
    setEmailError('');
    setError('');
    setNotice('');
    if (!/^\d{6}$/.test(emailOtp)) {
      setEmailError(translateText('Enter the six-digit verification code.'));
      return;
    }

    setVerifyingEmail(true);
    try {
      const response = await apiClient.post('/admin/profile/email-change/verify', { otp: emailOtp });
      const updatedEmail = response.data.data.email;
      setProfile((current) => ({ ...current, email: updatedEmail }));
      setEmailDraft(updatedEmail);
      setEmailCurrentPassword('');
      setEmailOtp('');
      setPendingEmail('');
      setEmailVerificationSent(false);
      onUserChange?.((current) => ({ ...current, email: updatedEmail }));
      setNotice(translateText('Your email address has been verified and updated.'));
    } catch (issue) {
      setEmailError(errorText(issue));
    } finally {
      setVerifyingEmail(false);
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
                    <span>Phone number</span>
                    <input maxLength={40} autoComplete="tel" value={edit.phone} onChange={(event) => setEdit((current) => ({ ...current, phone: event.target.value }))}/>
                  </label>
                </div>
                <button className="button" type="submit" disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save profile'}</button>
              </form>
              <div className="admin-profile-email-section">
                <label className="field admin-profile-email-address">
                  <span>Email address</span>
                  <input type="email" maxLength={254} autoComplete="email" value={emailDraft} disabled={emailVerificationSent || changingEmail || verifyingEmail} onChange={(event) => {
                    setEmailDraft(event.target.value);
                    setEmailError('');
                    if (emailVerificationSent) {
                      setEmailVerificationSent(false);
                      setPendingEmail('');
                      setEmailOtp('');
                    }
                  }}/>
                </label>
                <form className="admin-profile-email-form" onSubmit={emailVerificationSent ? verifyEmailChange : requestEmailChange}>
                <p className="admin-profile-email-note">To protect your account, your current email stays active until the new address is verified.</p>
                {!emailVerificationSent ? <>
                  <label className="field">
                    <span>Current password</span>
                    <input required type="password" autoComplete="current-password" maxLength={256} value={emailCurrentPassword} disabled={changingEmail} onChange={(event) => setEmailCurrentPassword(event.target.value)} />
                  </label>
                  <button className="button secondary" type="submit" disabled={changingEmail || emailDraft.trim().toLowerCase() === String(profile.email || '').toLowerCase()}>
                    {changingEmail ? 'Sending code…' : 'Update email'}
                  </button>
                </> : <>
                  <label className="field">
                    <span>Verification code sent to {pendingEmail}</span>
                    <input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={emailOtp} disabled={verifyingEmail} onChange={(event) => setEmailOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} />
                  </label>
                  <div className="admin-profile-email-actions">
                    <button className="button secondary" type="button" disabled={verifyingEmail} onClick={() => { setEmailVerificationSent(false); setPendingEmail(''); setEmailOtp(''); setEmailError(''); }}>
                      Change address
                    </button>
                    <button className="button" type="submit" disabled={verifyingEmail}>
                      {verifyingEmail ? 'Verifying…' : 'Verify email'}
                    </button>
                  </div>
                </>}
                {emailError && <p className="admin-profile-email-error" role="alert">{emailError}</p>}
                </form>
              </div>
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
          </aside>
        </div>
      )}
    </section>
  );
}
