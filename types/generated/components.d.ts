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

export interface CatalogProductBadgeAssignment extends Struct.ComponentSchema {
  collectionName: 'components_catalog_product_badge_assignments';
  info: {
    displayName: '\u041D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435 \u0431\u0435\u0439\u0434\u0436\u0430';
  };
  attributes: {
    badge: Schema.Attribute.Relation<
      'manyToOne',
      'api::product-badge.product-badge'
    > &
      Schema.Attribute.Required;
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

export interface NavigationMobileNavigationItem extends Struct.ComponentSchema {
  collectionName: 'components_navigation_mobile_navigation_items';
  info: {
    description: '\u041E\u0434\u0438\u043D \u043F\u0443\u043D\u043A\u0442 \u043C\u043E\u0431\u0438\u043B\u044C\u043D\u043E\u0439 \u043D\u0430\u0432\u0438\u0433\u0430\u0446\u0438\u0438. \u041C\u043E\u0436\u0435\u0442 \u043E\u0442\u043E\u0431\u0440\u0430\u0436\u0430\u0442\u044C\u0441\u044F \u0432 \u0433\u043E\u0440\u0438\u0437\u043E\u043D\u0442\u0430\u043B\u044C\u043D\u043E\u043C \u043C\u0435\u043D\u044E \u043D\u0430 \u0433\u043B\u0430\u0432\u043D\u043E\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 \u0438/\u0438\u043B\u0438 \u0432 \u043F\u043E\u043B\u043D\u043E\u044D\u043A\u0440\u0430\u043D\u043D\u043E\u043C \u043C\u043E\u0431\u0438\u043B\u044C\u043D\u043E\u043C \u043C\u0435\u043D\u044E.';
    displayName: '\u041F\u0443\u043D\u043A\u0442 \u043C\u043E\u0431\u0438\u043B\u044C\u043D\u043E\u0439 \u043D\u0430\u0432\u0438\u0433\u0430\u0446\u0438\u0438';
  };
  attributes: {
    homeImage: Schema.Attribute.Media<'images'>;
    href: Schema.Attribute.String & Schema.Attribute.Required;
    isActive: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    menuImage: Schema.Attribute.Media<'images'>;
    showInHome: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    showInMenu: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface ProductHarakteristika extends Struct.ComponentSchema {
  collectionName: 'components_product_harakteristika';
  info: {
    displayName: '\u0425\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0430';
  };
  attributes: {
    specification: Schema.Attribute.Relation<
      'oneToOne',
      'api::specification-type.specification-type'
    >;
    value: Schema.Attribute.String & Schema.Attribute.Required;
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
      'catalog.product-badge-assignment': CatalogProductBadgeAssignment;
      'navigation.category-link': NavigationCategoryLink;
      'navigation.mobile-navigation-item': NavigationMobileNavigationItem;
      'product.harakteristika': ProductHarakteristika;
    }
  }
}
