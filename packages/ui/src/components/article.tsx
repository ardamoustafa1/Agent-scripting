import { Fragment, createElement } from 'react';

import { parseArticleBody } from '@verbis/shared-types';

/**
 * A knowledge article body (ADR-0057): paragraphs, subheadings and lists rendered as elements.
 * The text is never interpreted as HTML (SECURITY §5.2).
 */
export function ArticleBody({
  body,
  headingLevel = 3,
}: {
  body: string;
  /** Level of the article's subheadings, one below the heading that names the article. */
  headingLevel?: 3 | 4 | 5;
}) {
  return (
    <div className="vb-article">
      {parseArticleBody(body).map((block, index) =>
        block.type === 'heading' ? (
          createElement(`h${String(headingLevel)}`, { key: index }, block.text)
        ) : block.type === 'list' ? (
          createElement(
            block.ordered ? 'ol' : 'ul',
            { key: index },
            block.items.map((item, at) => <li key={at}>{item}</li>),
          )
        ) : (
          <p key={index}>
            {block.lines.map((line, at) => (
              <Fragment key={at}>
                {at > 0 && <br />}
                {line}
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  );
}
