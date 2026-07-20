import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import type { SkillCatalogueItem } from '../lib/types'
import { displaySkillName, shortDescription } from '../lib/skillDisplay'
import EmptyState from '../components/shared/EmptyState'
import styles from './SkillsPage.module.css'

// C: Skills activation surface — turn skills on/off for the entire universe.
// This is different from CraftReviewPanel's inline picker which selects up to
// 3 of the already-active skills for a *specific* passage review. Keeping both:
// this page = what's available for the universe; editor picker = which 3 active
// skills apply to this passage right now.

const GROUP_LABELS: Record<string, string> = {
  editorial: 'Editorial',
  craft: 'Craft',
  genre: 'Genre',
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return 'The request could not be completed. Please try again.'
}

export default function SkillsPage() {
  const { universeId } = useParams<{ universeId: string }>()
  const [catalogue, setCatalogue] = useState<SkillCatalogueItem[]>([])
  const [activeNames, setActiveNames] = useState<string[]>([])
  const [savedNames, setSavedNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const loadRequestId = useRef(0)

  const loadSkills = useCallback(async () => {
    if (!universeId) {
      setLoading(false)
      return
    }

    const requestId = ++loadRequestId.current
    setLoading(true)
    setLoadError(null)
    setSaveError(null)
    setSaved(false)
    try {
      const [catalogueResponse, activeResponse] = await Promise.all([
        api.getSkills(),
        api.getUniverseSkills(universeId),
      ])
      if (requestId !== loadRequestId.current) return

      const names = activeResponse.skills.map((skill) => skill.skill_name)
      setCatalogue(catalogueResponse.skills)
      setActiveNames(names)
      setSavedNames(names)
    } catch (requestError) {
      if (requestId !== loadRequestId.current) return
      setLoadError(errorMessage(requestError))
    } finally {
      if (requestId === loadRequestId.current) setLoading(false)
    }
  }, [universeId])

  useEffect(() => {
    void loadSkills()
    return () => {
      loadRequestId.current += 1
    }
  }, [loadSkills])

  const groupedSkills = useMemo(() => {
    const groups = new Map<string, SkillCatalogueItem[]>()
    for (const skill of catalogue) {
      const groupKey = skill.name === 'genre-conventions' ? 'genre' : skill.stage === 'craft' ? 'craft' : 'editorial'
      const group = groups.get(groupKey) ?? []
      group.push(skill)
      groups.set(groupKey, group)
    }
    const order = ['editorial', 'craft', 'genre']
    return [...groups.entries()].sort(([left], [right]) => order.indexOf(left) - order.indexOf(right))
  }, [catalogue])

  const toggle = (skillName: string) => {
    setSaved(false)
    setSaveError(null)
    setActiveNames((current) =>
      current.includes(skillName)
        ? current.filter((name) => name !== skillName)
        : [...current, skillName],
    )
  }

  const save = async () => {
    if (!universeId || saving) return
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const response = await api.updateUniverseSkills(universeId, activeNames)
      const names = response.skills.map((skill) => skill.skill_name)
      setActiveNames(names)
      setSavedNames(names)
      setSaved(true)
    } catch (requestError) {
      setSaveError(errorMessage(requestError))
    } finally {
      setSaving(false)
    }
  }

  const hasChanges =
    activeNames.length !== savedNames.length ||
    activeNames.some((name) => !savedNames.includes(name))

  if (!universeId) return null

  return (
    <main className={styles.wrap}>
      <div className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Editorial system</p>
          <h1 className={styles.title}>Skills</h1>
          <p className={styles.subtitle}>
            Choose which editorial voices are available when you review a passage.
            The editor's craft picker lets you pick up to three active skills per review.
          </p>
        </div>
        <div className={styles.headerActions}>
          {!loading && !loadError && (
            <span className={styles.count} aria-live="polite">
              {activeNames.length} active
            </span>
          )}
          <button
            type="button"
            className={styles.saveButton}
            data-testid="skills-save-button"
            disabled={saving || loading || !hasChanges}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
          </button>
        </div>
      </div>

      {saveError && (
        <p className={styles.error} role="alert">
          Could not save skill settings: {saveError} Your selection is unsaved — try again when ready.
        </p>
      )}
      {saved && (
        <p className={styles.savedStatus} role="status" aria-live="polite">
          Skill settings saved.
        </p>
      )}

      {loading ? (
        <div className={styles.state} role="status" aria-live="polite">
          Loading skill catalogue…
        </div>
      ) : loadError ? (
        <section className={`${styles.state} ${styles.errorState}`} role="alert">
          <p>Could not load editorial skills: {loadError}</p>
          <p>Retry to load the catalogue and your saved skill settings.</p>
          <button className={styles.retryButton} type="button" onClick={() => void loadSkills()}>
            Retry loading skills
          </button>
        </section>
      ) : catalogue.length === 0 ? (
        <EmptyState
          title="No skills available"
          detail="The editorial skill catalogue is empty. Check that the backend has populated the skills table."
        />
      ) : (
        <div className={styles.groups} data-testid="skills-groups">
          {groupedSkills.map(([stage, skills]) => (
            <section key={stage} className={styles.group} aria-labelledby={`skill-stage-${stage}`}>
              <div className={styles.groupHeader}>
                <h2 id={`skill-stage-${stage}`} className={styles.groupTitle}>
                  {GROUP_LABELS[stage] || stage}
                </h2>
                <span className={styles.groupCount}>{skills.length}</span>
              </div>
              <div className={styles.skillGrid}>
                {skills.map((skill) => {
                  const active = activeNames.includes(skill.name)
                  const inputId = `skill-toggle-${skill.name}`
                  return (
                    <div
                      key={skill.name}
                      className={`${styles.card} ${active ? styles.cardActive : ''}`}
                      data-testid={`skill-card-${skill.name}`}
                    >
                      <label htmlFor={inputId} className={styles.cardBody}>
                        <input
                          id={inputId}
                          type="checkbox"
                          checked={active}
                          disabled={saving}
                          onChange={() => toggle(skill.name)}
                          aria-label={`${displaySkillName(skill.name)}: ${active ? 'active' : 'off'}`}
                        />
                        <span className={styles.cardText}>
                          <span className={styles.cardTopline}>
                            <span className={styles.skillName}>{displaySkillName(skill.name)}</span>
                            <span className={styles.status} aria-hidden="true">
                              {active ? 'Active' : 'Off'}
                            </span>
                          </span>
                          <span className={styles.description}>{shortDescription(skill.description)}</span>
                          {skill.genre_tags.length > 0 && (
                            <span className={styles.tags}>{skill.genre_tags.join(' · ')}</span>
                          )}
                        </span>
                      </label>
                      <details className={styles.details}>
                        <summary className={styles.detailsSummary}>Details</summary>
                        <p className={styles.fullDescription}>{skill.description}</p>
                      </details>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  )
}
