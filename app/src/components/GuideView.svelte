<script>
  import Prose from './Prose.svelte';
  import GuideContentEditor from './GuideContentEditor.svelte';
  import TrashIcon from './TrashIcon.svelte';
  import { langValue } from '../lib/package.js';

  let { pkg, guide, lang, onOpen, onTag = null, onView = null, editing = false, canEdit = false, onStartEditing = null, onEdit, onDelete, onToggleDraft, onContent, onAddRef, onUploadMedia = null, onTitle, focusTitle = false, onTitleFocused = null } = $props();

  const shownTitle = $derived(langValue(guide.title, guide.title_i18n, lang));

  let titleInput = $state(null);
  $effect(() => {
    if (focusTitle && titleInput) {
      titleInput.focus();
      titleInput.select();
      onTitleFocused?.();
    }
  });

  const content = $derived(guide.content || {});
  const shownLang = $derived(content[lang] ? lang : pkg.languages.find((l) => content[l]) || Object.keys(content)[0]);
  const body = $derived(content[shownLang] || '');

  // Auto-stamp "updated" on a real change (inline edits), never on mere open.
  const today = () => new Date().toISOString().slice(0, 10);
  let baselineId = null, baseline = null;
  $effect(() => {
    if (!editing || !guide) return;
    const key = JSON.stringify({ ...$state.snapshot(guide), updated: undefined });
    if (guide.id !== baselineId) { baselineId = guide.id; baseline = key; return; }
    if (key !== baseline) { baseline = key; const t = today(); if (guide.updated !== t) guide.updated = t; }
  });
</script>

<div class="guide-row">
  <div class="guide-col">
    {#if !editing && shownLang && shownLang !== lang}
      <p class="notice no-print">
        Not available in {lang.toUpperCase()} — showing the {shownLang.toUpperCase()} version instead.
      </p>
    {/if}

    {#if editing && guide.draft}
      <p class="draft-banner">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" />
        </svg>
        <span><strong>Draft</strong> — kept here, but left out of the plan you export for your heir.</span>
      </p>
    {/if}

    <article class="card guide" class:is-draft={guide.draft}>
      {#if editing}
        <div class="guide-page guide-write">
          <input bind:this={titleInput} class="gtitle-input" value={shownTitle} oninput={(e) => onTitle?.(lang, e.target.value)} placeholder="e.g. Start here, Bitcoin instructions…" aria-label="Guide title" />
          <div class="editor-host"><GuideContentEditor {pkg} raw={guide} {lang} {onContent} {onAddRef} {onUploadMedia} /></div>
        </div>
      {:else}
        <div class="guide-page guide-read">
        <header class="ghead">
          <h2>{shownTitle}</h2>
          {#if guide.updated}<span class="tiny muted">Updated {guide.updated}</span>{/if}
        </header>
        {#if canEdit && !body.trim()}
          <div class="guide-empty no-print">
            <svg class="empty-art" width="92" height="92" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path class="art-page" d="M16 8h22l10 10v38a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" />
              <path class="art-page" d="M38 8v10h10" />
              <line class="art-line" x1="22" y1="30" x2="42" y2="30" />
              <line class="art-line" x1="22" y1="38" x2="42" y2="38" />
              <line class="art-line" x1="22" y1="46" x2="34" y2="46" />
              <path class="art-pen" d="M49 33l8 8-13 13-9 1 1-9 13-13z" />
            </svg>
            <h3>Nothing here yet</h3>
            <button class="btn btn-primary" onclick={() => onStartEditing?.()}>Start writing</button>
            <p class="kbd-hint">or press <kbd>Ctrl</kbd> <kbd>E</kbd></p>
          </div>
        {:else}
          <Prose {pkg} markdown={body} {onOpen} {onTag} {onView} />
        {/if}
        </div>
      {/if}
    </article>

  </div>

  {#if editing}
    <aside class="guide-side no-print">
      <button
        class="iconbtn gtool-pub"
        class:is-draft={guide.draft}
        data-tip={guide.draft ? 'Draft — hidden from the exported plan. Click to publish.' : 'Published — your heir will see this. Click to make it a draft.'}
        data-tip-pos="left"
        aria-label={guide.draft ? 'Draft guide. Click to publish.' : 'Published guide. Click to make draft.'}
        aria-pressed={!!guide.draft}
        onclick={() => onToggleDraft?.()}
      >
        {#if guide.draft}
          <!-- eye-off: hidden from the heir -->
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        {:else}
          <!-- eye: visible to the heir -->
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
          </svg>
        {/if}
      </button>
      <button class="iconbtn" data-tip="Guide properties (who it's for, importance)" data-tip-pos="left" aria-label="Guide properties" onclick={() => onEdit?.()}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
        </svg>
      </button>
      <button class="iconbtn danger" data-tip="Delete guide" data-tip-pos="left" aria-label="Delete guide" onclick={() => onDelete?.()}><TrashIcon /></button>
    </aside>
  {/if}
</div>

<style>
  /* Guide page: full-width content; the tools float in the right margin so the
     editor never shrinks between read and edit. */
  /* Fill the (stretched) content column so a short/empty guide is exactly as
     tall as the left menu — never taller. */
  .guide-row { position: relative; flex: 1; display: flex; flex-direction: column; }
  .guide-col { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 22px; }
  /* A guide reads like a sheet of paper — square corners, not rounded. */
  .guide { flex: 1; display: flex; flex-direction: column; border-radius: 0; }
  .editor-host :global(.ce) { flex: 1; }
  .guide-side { position: absolute; top: 0; right: -52px; display: flex; flex-direction: column; gap: 8px; }
  @media (max-width: 1140px) {
    .guide-row { display: flex; flex-direction: column-reverse; }
    .guide-side { position: static; flex-direction: row; justify-content: flex-end; margin-bottom: 6px; }
  }
  /* Publish / draft toggle: neutral when published, soft amber when draft.
     (Base look comes from the global .iconbtn — see DESIGN.md.) */
  :global(.iconbtn).gtool-pub.is-draft { color: var(--draft); background: var(--draft-wash); }
  .draft-banner {
    display: flex; align-items: center; gap: 9px;
    margin: 0; padding: 9px 13px;
    border: 0; border-left: 2px solid var(--draft); border-radius: 0;
    background: var(--draft-wash);
    color: var(--ink-soft); font-size: 13px;
  }
  .draft-banner svg { flex: none; color: var(--draft); }
  .is-draft.guide { border-style: dashed; }
  /* The dashed frame is a screen-only "draft" cue — never print it. */
  @media print { .is-draft.guide { border: none; } }
  .ghead { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 22px; }
  .ghead h2 { font-size: clamp(28px, 4vw, 40px); font-weight: 300; }
  .gtitle-input {
    display: block; width: 100%;
    font: inherit; font-size: clamp(28px, 4vw, 40px); font-weight: 300; letter-spacing: -0.01em; line-height: 1.3;
    color: var(--ink); background: transparent;
    border: 1px solid transparent; border-radius: 8px; padding: 6px 8px; margin: -6px -8px 20px;
  }
  .gtitle-input:focus { outline: none; border-color: var(--accent); background: var(--paper); }
  /* Both modes share one "page" gutter, so a guide has identical margins whether
     you're reading or editing it. */
  .guide-page { padding-inline: clamp(0px, 4vw, 44px); padding-block: clamp(18px, 3.5vw, 44px); }
  .guide-write { flex: 1; display: flex; flex-direction: column; }
  @media print { .guide-page { padding: clamp(12px, 3vw, 32px) clamp(0px, 4vw, 36px); } }
  /* The page supplies the gutter, so the editor sits flush inside it — its
     toolbar and text line up with the read-mode text column. The toolbar still
     sticks just below the page's top bar (--ce-toolbar-top). */
  .editor-host { flex: 1; display: flex; flex-direction: column; --ce-toolbar-top: var(--topbar-h, 58px); }
  .editor-host :global(.ce:not(.full) .toolbar) { padding-inline: 0; }
  .editor-host :global(.ce:not(.full) .ce-edit) { padding-inline: 0; }
  /* The guide document — title + body — uses the plan's reading font (the
     owner's choice, honoured in the heir reader too). The toolbar/UI keeps the
     interface font. Default falls back to the app's mono. */
  .guide-read,
  .gtitle-input,
  .editor-host :global(.ce:not(.full) .ce-edit) {
    font-family: var(--reading-font, "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace);
  }
  .notice {
    padding: 10px 14px;
    background: var(--accent-wash); border-radius: 0;
    border-left: 2px solid var(--accent);
    color: var(--ink-soft); font-size: 13px;
  }
  /* Empty guide (read mode, owner only): a calm "blank page" call-to-action. */
  .guide-empty {
    flex: 1; min-height: 240px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; gap: 6px; padding: 32px 16px;
  }
  .empty-art { color: var(--accent); opacity: 0.9; margin-bottom: 12px; }
  .empty-art .art-line { stroke: var(--accent); opacity: 0.4; }
  .empty-art .art-pen { stroke: var(--accent-deep); fill: var(--accent-wash); }
  .guide-empty h3 { font-size: 19px; font-weight: 500; }
  .guide-empty .btn { margin-top: 14px; }
  .kbd-hint { margin-top: 2px; font-size: 12.5px; color: var(--ink-mute); }
  .kbd-hint kbd {
    font: inherit; font-size: 11.5px; color: var(--ink-soft);
    background: var(--bg); border: 1px solid var(--rule); border-bottom-width: 2px;
    border-radius: 5px; padding: 1px 6px; margin: 0 1px;
  }
</style>
