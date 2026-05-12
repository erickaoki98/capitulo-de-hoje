import { config, collection, fields } from '@keystatic/core';

const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? 'https://capitulo-de-hoje.pages.dev';

export default config({
  storage: {
    kind: 'github',
    repo: 'erickaoki98/capitulo-de-hoje',
  },
  ui: {
    brand: { name: 'Meu Blog' },
  },

  collections: {
    blog: collection({
      label: 'Posts',
      slugField: 'title',
      path: 'src/content/blog/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ name: { label: 'Título' } }),
        description: fields.text({ label: 'Descrição', multiline: true }),
        pubDate: fields.date({ label: 'Data de publicação', defaultValue: { kind: 'today' } }),
        updatedDate: fields.date({ label: 'Última atualização' }),
        author: fields.text({ label: 'Autor' }),
        tags: fields.array(fields.text({ label: 'Tag' }), {
          label: 'Tags',
          itemLabel: (props) => props.fields.value.value ?? 'Tag',
        }),
        draft: fields.checkbox({ label: 'Rascunho', defaultValue: false }),
        heroImage: fields.image({
          label: 'Imagem de capa',
          directory: 'src/assets',
          publicPath: '../../assets/',
        }),
        content: fields.markdoc({ label: 'Conteúdo' }),
      },
    }),
  },
});
