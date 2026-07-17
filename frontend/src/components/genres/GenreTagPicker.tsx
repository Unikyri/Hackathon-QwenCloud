import { Search, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { GENRE_OPTIONS } from '../../lib/genres'
import styles from './GenreTagPicker.module.css'

interface GenreTagPickerProps {
  value: string[]
  onChange: (nextValue: string[]) => void
  id?: string
  label?: string
  disabled?: boolean
  className?: string
}

export function GenreTagPicker({
  value,
  onChange,
  id,
  label = 'Genres',
  disabled = false,
  className,
}: GenreTagPickerProps) {
  const generatedId = useId()
  const searchId = id ?? `genre-search-${generatedId}`
  const summaryId = `${searchId}-summary`
  const [query, setQuery] = useState('')

  const selectedOptions = useMemo(
    () => GENRE_OPTIONS.filter((option) => value.includes(option.value)),
    [value],
  )
  const selectedValues: string[] = selectedOptions.map((option) => option.value)
  const selectedSet = new Set<string>(selectedValues)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleOptions = GENRE_OPTIONS.filter((option) => (
    !normalizedQuery
    || option.label.toLocaleLowerCase().includes(normalizedQuery)
    || option.value.includes(normalizedQuery)
  ))

  function toggleGenre(genre: string) {
    if (disabled) return
    onChange(
      selectedSet.has(genre)
        ? selectedValues.filter((value) => value !== genre)
        : [...selectedValues, genre],
    )
  }

  return (
    <fieldset className={[styles.root, className].filter(Boolean).join(' ')} disabled={disabled}>
      <legend className={styles.legend}>{label}</legend>

      <label className={styles.searchLabel} htmlFor={searchId}>
        Search genres
        <span className={styles.searchField}>
          <Search aria-hidden="true" className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            id={searchId}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search the genre list"
            type="search"
            value={query}
          />
        </span>
      </label>

      <div aria-live="polite" id={summaryId}>
        <p className={styles.selectionSummary}>
          {selectedOptions.length === 0
            ? 'No genres selected. Genres are optional.'
            : `${selectedOptions.length} ${selectedOptions.length === 1 ? 'genre' : 'genres'} selected.`}
        </p>
        {selectedOptions.length > 0 && (
          <ul aria-label="Selected genres" className={styles.selectedList}>
            {selectedOptions.map((option) => (
              <li className={styles.selectedTag} key={option.value}>
                {option.label}
                <button
                  aria-label={`Remove ${option.label}`}
                  className={styles.removeButton}
                  onClick={() => toggleGenre(option.value)}
                  type="button"
                >
                  <X aria-hidden="true" className={styles.removeIcon} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div aria-describedby={summaryId} aria-label="Available genres" className={styles.options} role="group">
        {visibleOptions.map((option) => {
          const selected = selectedSet.has(option.value)
          return (
            <label
              className={styles.option}
              data-disabled={disabled}
              data-selected={selected}
              key={option.value}
            >
              <input
                aria-label={option.label}
                checked={selected}
                className={styles.checkbox}
                disabled={disabled}
                onChange={() => toggleGenre(option.value)}
                type="checkbox"
              />
              {option.label}
            </label>
          )
        })}
        {visibleOptions.length === 0 && (
          <p className={styles.empty} role="status">No genres match “{query}”.</p>
        )}
      </div>
    </fieldset>
  )
}
