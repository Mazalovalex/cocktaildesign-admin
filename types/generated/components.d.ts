import type { Schema, Struct } from '@strapi/strapi';

export interface BlocksHeadingBlock extends Struct.ComponentSchema {
  collectionName: 'components_blocks_heading_blocks';
  info: {
    displayName: 'HeadingBlock';
  };
  attributes: {
    content: Schema.Attribute.String & Schema.Attribute.Required;
    level: Schema.Attribute.Enumeration<['h2', 'h3']> &
      Schema.Attribute.Required;
  };
}

export interface BlocksImageBlock extends Struct.ComponentSchema {
  collectionName: 'components_blocks_image_blocks';
  info: {
    displayName: 'ImageBlock';
    icon: 'landscape';
  };
  attributes: {
    alt: Schema.Attribute.String;
    caption: Schema.Attribute.String;
    image: Schema.Attribute.Media<'images' | 'files' | 'videos' | 'audios'> &
      Schema.Attribute.Required;
  };
}

export interface BlocksLinkBlock extends Struct.ComponentSchema {
  collectionName: 'components_blocks_link_blocks';
  info: {
    displayName: 'LinkBlock';
    icon: 'link';
  };
  attributes: {
    description: Schema.Attribute.Text;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    url: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface BlocksListBlock extends Struct.ComponentSchema {
  collectionName: 'components_blocks_list_blocks';
  info: {
    displayName: 'ListBlock';
    icon: 'bulletList';
  };
  attributes: {
    items: Schema.Attribute.JSON & Schema.Attribute.Required;
    ordered: Schema.Attribute.Boolean;
  };
}

export interface BlocksTextBlock extends Struct.ComponentSchema {
  collectionName: 'components_blocks_text_blocks';
  info: {
    displayName: 'TextBlock';
    icon: 'bold';
  };
  attributes: {
    content: Schema.Attribute.Text & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'blocks.heading-block': BlocksHeadingBlock;
      'blocks.image-block': BlocksImageBlock;
      'blocks.link-block': BlocksLinkBlock;
      'blocks.list-block': BlocksListBlock;
      'blocks.text-block': BlocksTextBlock;
    }
  }
}
