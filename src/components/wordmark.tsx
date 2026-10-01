import { SITE_NAME, WORDMARK } from '../domain/site'

/**
 * The pepper beside the wordmark: the one brand every surface draws, so the app, the legal pages
 * and the authorization pages a member reaches mid-flow from an agent all read as the same site.
 * The image is decorative; the wordmark carries the name, drawn as its first part, then the rest
 * in the pepper red (`.brand em, .site-brand em, .authorize-brand em`). Derived from the same
 * parts as the site name, so the two cannot disagree.
 */
export function BrandMark() {
  const [lead, accent] = WORDMARK
  return (
    <>
      <img alt="" className="brand-pepper" src="/spice-mark.svg" />
      <span>{lead}<em>{accent}</em></span>
    </>
  )
}

export const HOME_LINK_LABEL = `${SITE_NAME} home`
