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

export interface NavigationCategoryLink extends Struct.ComponentSchema {
  collectionName: 'components_navigation_category_links';
  info: {
    displayName: 'Category Link';
  };
  attributes: {
    category: Schema.Attribute.Relation<
      'oneToOne',
      'api::moysklad-category.moysklad-category'
    >;
    isVisible: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    label: Schema.Attribute.String;
  };
}

export interface ProductHarakteristika extends Struct.ComponentSchema {
  collectionName: 'components_product_harakteristika';
  info: {
    displayName: '\u0425\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0430';
  };
  attributes: {
    kategorii: Schema.Attribute.Relation<
      'oneToOne',
      'api::moysklad-category.moysklad-category'
    >;
    specification: Schema.Attribute.Relation<
      'oneToOne',
      'api::specification-type.specification-type'
    >;
    value: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface ProductSpecificationTemplateItem
  extends Struct.ComponentSchema {
  collectionName: 'components_product_specification_template_items';
  info: {
    displayName: '\u041F\u0443\u043D\u043A\u0442 \u0448\u0430\u0431\u043B\u043E\u043D\u0430 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0438';
  };
  attributes: {
    isRequired: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    sortOrder: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<100>;
    specification: Schema.Attribute.Relation<
      'manyToOne',
      'api::specification-type.specification-type'
    > &
      Schema.Attribute.Required;
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
      'navigation.category-link': NavigationCategoryLink;
      'product.harakteristika': ProductHarakteristika;
      'product.specification-template-item': ProductSpecificationTemplateItem;
    }
  }
}
