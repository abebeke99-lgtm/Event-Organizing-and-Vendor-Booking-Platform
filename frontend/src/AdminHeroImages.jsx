import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import apiClient from './api/axios.js';
import { translate, useLanguage } from './language.js';
import { validateHeroSlideFile, validateHeroSlideLink } from './heroSlidesUtils.js';

const MAX_HERO_SLIDES = 5;

function getErrorMessage(error) {
  return error.response?.data?.message || error.response?.data?.error || error.message || 'The hero image request failed.';
}

function resolveAdminImageUrl(path) {
  const baseUrl = apiClient.defaults.baseURL;
  return !baseUrl || baseUrl.startsWith('/') ? path : new URL(path, baseUrl).toString();
}

function createSlideFormData({ file, altText, linkUrl, isActive = true }) {
  const formData = new FormData();
  if (file) formData.append('image', file);
  formData.append('altText', altText);
  formData.append('linkUrl', linkUrl);
  formData.append('isActive', String(isActive));
  return formData;
}

export default function AdminHeroImages() {
  const language = useLanguage();
  const t = (key) => translate(key, language);
  const fileInputRef = useRef(null);
  const replaceInputRef = useRef(null);
  const [slides, setSlides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [altText, setAltText] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [formError, setFormError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [busyId, setBusyId] = useState(null);
  const [replaceId, setReplaceId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast] = useState(null);

  const loadSlides = useCallback(async (signal) => {
    setLoading(true);
    setLoadError('');
    try {
      const { data } = await apiClient.get('/admin/hero-slides', { signal });
      if (!Array.isArray(data?.data)) throw new Error(t('heroImagesLoadError'));
      setSlides(data.data);
    } catch (error) {
      if (error.name !== 'CanceledError' && error.name !== 'AbortError' && !signal?.aborted) {
        setLoadError(getErrorMessage(error));
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [language]);

  useEffect(() => {
    const controller = new AbortController();
    loadSlides(controller.signal);
    return () => controller.abort();
  }, [loadSlides, retryKey]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function chooseFile(nextFile) {
    const validationMessage = validateHeroSlideFile(nextFile);
    if (validationMessage) {
      const messageKey = validationMessage.includes('5 MB') ? 'heroImagesFileTooLarge'
        : validationMessage.includes('Choose an image') ? 'heroImagesFileRequired' : 'heroImagesFileMismatch';
      setFormError(t(messageKey));
      return false;
    }
    setFormError('');
    setFile(nextFile);
    return true;
  }

  async function submitUpload(event) {
    event.preventDefault();
    if (!file) return setFormError(t('heroImagesFileRequired'));
    if (!altText.trim()) return setFormError(t('heroImagesEnterAltText'));
    if (altText.trim().length > 150) return setFormError(t('heroImagesAltTooLong'));
    if (validateHeroSlideLink(linkUrl)) return setFormError(t('heroImagesLinkInvalid'));
    if (slides.length >= MAX_HERO_SLIDES) return setFormError(t('heroImagesLimitReached'));

    setUploading(true);
    setUploadProgress(0);
    setFormError('');
    try {
      await apiClient.post('/admin/hero-slides', createSlideFormData({ file, altText, linkUrl }), {
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) setUploadProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
        },
      });
      setFile(null);
      setAltText('');
      setLinkUrl('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setToast({ kind: 'success', text: t('heroImagesUploaded') });
      await loadSlides();
    } catch (error) {
      setFormError(getErrorMessage(error));
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  async function updateSlide(slide, changes, imageFile) {
    setBusyId(slide.id);
    try {
      const data = createSlideFormData({
        file: imageFile,
        altText: changes.altText ?? slide.altText,
        linkUrl: changes.linkUrl ?? slide.linkUrl ?? '',
        isActive: changes.isActive ?? slide.isActive,
      });
      await apiClient.put(`/admin/hero-slides/${slide.id}`, data);
      setToast({ kind: 'success', text: imageFile ? t('heroImagesUpdated') : changes.isActive !== undefined ? t('heroImagesActiveChanged') : t('heroImagesUpdated') });
      await loadSlides();
    } catch (error) {
      setToast({ kind: 'error', text: getErrorMessage(error) });
    } finally {
      setBusyId(null);
      setReplaceId(null);
      if (replaceInputRef.current) replaceInputRef.current.value = '';
    }
  }

  async function handleReplacement(event) {
    const replacement = event.target.files?.[0];
    const slide = slides.find((item) => item.id === replaceId);
    if (!replacement || !slide) {
      event.target.value = '';
      setReplaceId(null);
      return;
    }
    const validationMessage = validateHeroSlideFile(replacement);
    if (validationMessage) {
      const messageKey = validationMessage.includes('5 MB') ? 'heroImagesFileTooLarge'
        : validationMessage.includes('Choose an image') ? 'heroImagesFileRequired' : 'heroImagesFileMismatch';
      setToast({ kind: 'error', text: t(messageKey) });
      event.target.value = '';
      setReplaceId(null);
      return;
    }
    setFormError('');
    await updateSlide(slide, {}, replacement);
  }

  async function reorderSlide(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= slides.length) return;
    const next = [...slides];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    setBusyId(slides[index].id);
    try {
      const { data } = await apiClient.patch('/admin/hero-slides/reorder', { ids: next.map((slide) => slide.id) });
      setSlides(data.data);
      setToast({ kind: 'success', text: t('heroImagesReordered') });
    } catch (error) {
      setToast({ kind: 'error', text: getErrorMessage(error) });
    } finally {
      setBusyId(null);
    }
  }

  async function deleteSlide() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await apiClient.delete(`/admin/hero-slides/${deleteTarget.id}`);
      setDeleteTarget(null);
      setToast({ kind: 'success', text: t('heroImagesDeleted') });
      await loadSlides();
    } catch (error) {
      setToast({ kind: 'error', text: getErrorMessage(error) });
      setDeleteTarget(null);
    } finally {
      setBusyId(null);
    }
  }

  return <section className="hero-images-admin">
    <header className="hero-images-heading">
      <div>
        <p className="eyebrow">EVENTHUB · HOME PAGE</p>
        <h1>{t('adminHeroImagesTitle')}</h1>
        <p className="muted">{t('adminHeroImagesDescription')}</p>
      </div>
      <strong className="hero-images-counter">{t('heroImagesCount').replace('{count}', String(slides.length))}</strong>
    </header>

    {toast && <div className={`hero-images-toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>{toast.text}<button type="button" onClick={() => setToast(null)} aria-label={t('dismiss')}><X size={16}/></button></div>}

    <form className="panel hero-images-upload-form" onSubmit={submitUpload} noValidate>
      <div className="hero-images-upload-title"><ImagePlus size={19}/><h2>{t('heroImagesUpload')}</h2></div>
      <p className="muted">{t('heroImagesHint')}</p>
      <label className="field">
        <span>{t('heroImagesChooseFile')} · {t('heroImagesFileTypes')}</span>
        <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={(event) => chooseFile(event.target.files?.[0])}/>
      </label>
      {file && <div className="hero-images-preview-wrap"><img className="hero-images-upload-preview" src={previewUrl} alt={t('heroImagesPreview')}/><span>{file.name}</span><button type="button" className="text-action" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>{t('heroImagesCancel')}</button></div>}
      <label className="field"><span>{t('heroImagesAltText')}</span><input value={altText} maxLength={150} onChange={(event) => setAltText(event.target.value)} aria-invalid={Boolean(formError)}/></label>
      <label className="field"><span>{t('heroImagesLink')}</span><input type="text" value={linkUrl} maxLength={2048} placeholder="/events or https://example.com" onChange={(event) => setLinkUrl(event.target.value)}/></label>
      {formError && <p className="hero-images-form-error" role="alert">{formError}</p>}
      {uploading && <div className="hero-images-progress" role="status" aria-label={`${uploadProgress}%`}><span style={{ width: `${uploadProgress}%` }}/><small>{uploadProgress}%</small></div>}
      <button className="button" type="submit" disabled={uploading || slides.length >= MAX_HERO_SLIDES}>{uploading ? t('heroImagesUploading') : <><Upload size={15}/>{t('heroImagesUpload')}</>}</button>
    </form>

    {loading ? <div className="panel hero-images-state" role="status"><span className="spinner"/>{t('heroImagesLoading')}</div>
      : loadError ? <div className="panel hero-images-state error" role="alert"><p>{loadError || t('heroImagesLoadError')}</p><button className="button secondary" type="button" onClick={() => setRetryKey((current) => current + 1)}><RefreshCw size={15}/>{t('heroImagesRetry')}</button></div>
        : slides.length === 0 ? <div className="panel hero-images-state"><ImagePlus size={25}/><p>{t('heroImagesEmpty')}</p></div>
          : <div className="hero-images-list" aria-label={t('adminHeroImagesTitle')}>
            {slides.map((slide, index) => <article className="panel hero-images-card" key={slide.id}>
              <img src={resolveAdminImageUrl(slide.imageUrl)} alt={slide.altText} width="320" height="160" loading="lazy" crossOrigin="use-credentials"/>
              <div className="hero-images-card-content">
                <div className="hero-images-card-title"><strong>{t('heroSlidePosition').replace('{current}', String(index + 1)).replace('{total}', String(slides.length))}</strong>{index === 0 && <span>{t('heroImagesFirstSlide')}</span>}</div>
                <p>{slide.altText}</p>
                {slide.linkUrl && <a href={slide.linkUrl} className="hero-images-link-preview" target="_blank" rel="noopener noreferrer">{slide.linkUrl}</a>}
                <label className="hero-images-active-toggle"><input type="checkbox" checked={slide.isActive} disabled={busyId === slide.id} onChange={(event) => updateSlide(slide, { isActive: event.target.checked })}/><span>{t('heroImagesActive')}</span></label>
              </div>
              <div className="hero-images-card-actions">
                <button className="button secondary" type="button" onClick={() => { setReplaceId(slide.id); replaceInputRef.current?.click(); }} disabled={busyId === slide.id}><RefreshCw size={15}/>{t('heroImagesReplace')}</button>
                <button className="button secondary" type="button" onClick={() => reorderSlide(index, -1)} disabled={index === 0 || busyId === slide.id} aria-label={`${t('heroImagesMoveUp')}: ${slide.altText}`}><ArrowUp size={15}/>{t('heroImagesMoveUp')}</button>
                <button className="button secondary" type="button" onClick={() => reorderSlide(index, 1)} disabled={index === slides.length - 1 || busyId === slide.id} aria-label={`${t('heroImagesMoveDown')}: ${slide.altText}`}><ArrowDown size={15}/>{t('heroImagesMoveDown')}</button>
                <button className="button danger" type="button" onClick={() => setDeleteTarget(slide)} disabled={busyId === slide.id}><Trash2 size={15}/>{t('heroImagesDelete')}</button>
              </div>
            </article>)}
          </div>}

    <input ref={replaceInputRef} className="visually-hidden" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={handleReplacement} aria-label={t('heroImagesReplace')}/>

    {deleteTarget && <div className="overlay hero-images-delete-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null); }}>
      <section className="modal hero-images-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="hero-images-delete-title">
        <div className="modal-head"><h2 id="hero-images-delete-title">{t('heroImagesDeleteTitle')}</h2><button className="icon-button" type="button" onClick={() => setDeleteTarget(null)} aria-label={t('heroImagesCancel')}><X size={17}/></button></div>
        <div className="modal-body"><p>{t('heroImagesDeleteDescription')}</p><strong>{deleteTarget.altText}</strong></div>
        <div className="modal-foot"><button className="button secondary" type="button" onClick={() => setDeleteTarget(null)}>{t('heroImagesCancel')}</button><button className="button danger" type="button" onClick={deleteSlide} disabled={busyId === deleteTarget.id}>{t('heroImagesConfirmDelete')}</button></div>
      </section>
    </div>}
  </section>;
}
