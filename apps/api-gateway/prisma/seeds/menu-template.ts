export interface MenuItemAddonOptionTemplate {
  name: string;
  price: number;
}

export interface MenuItemAddonTemplate {
  name: string;
  minSelection: number;
  maxSelection: number;
  options: MenuItemAddonOptionTemplate[];
}

export interface MenuItemVariantTemplate {
  name: string;
  price: number;
}

export interface MenuItemTemplate {
  name: string;
  description: string;
  basePrice: number;
  isVegetarian?: boolean;
  isVegan?: boolean;
  variants?: MenuItemVariantTemplate[];
  addons?: MenuItemAddonTemplate[];
}

export interface MenuCategoryTemplate {
  name: string;
  description: string;
  items: MenuItemTemplate[];
}

/**
 * One shared menu shape applied to every flagship restaurant (see 06/07 seed files) — realistic
 * enough to exercise variants, addon groups, veg/vegan flags, and availability toggling, without
 * hand-writing bespoke menus for each of the 5 restaurants.
 */
export const MENU_TEMPLATE: MenuCategoryTemplate[] = [
  {
    name: 'Starters',
    description: 'Appetizers to start your meal.',
    items: [
      {
        name: 'Chicken 65',
        description: 'Spicy deep-fried chicken bites.',
        basePrice: 220,
        addons: [
          {
            name: 'Spice Level',
            minSelection: 1,
            maxSelection: 1,
            options: [
              { name: 'Mild', price: 0 },
              { name: 'Medium', price: 0 },
              { name: 'Hot', price: 0 },
            ],
          },
        ],
      },
      {
        name: 'Paneer Tikka',
        description: 'Chargrilled cottage cheese skewers.',
        basePrice: 210,
        isVegetarian: true,
      },
      {
        name: 'Veg Spring Rolls',
        description: 'Crispy rolls with mixed vegetables.',
        basePrice: 180,
        isVegetarian: true,
        isVegan: true,
      },
    ],
  },
  {
    name: 'Biryani & Rice',
    description: 'Signature dum-cooked biryanis.',
    items: [
      {
        name: 'Chicken Dum Biryani',
        description: 'Slow-cooked basmati rice with marinated chicken.',
        basePrice: 249,
        variants: [
          { name: 'Half', price: 249 },
          { name: 'Full', price: 449 },
        ],
        addons: [
          {
            name: 'Extras',
            minSelection: 0,
            maxSelection: 3,
            options: [
              { name: 'Raita', price: 30 },
              { name: 'Boiled Egg', price: 20 },
              { name: 'Extra Gravy', price: 40 },
            ],
          },
        ],
      },
      {
        name: 'Mutton Biryani',
        description: 'Rich, slow-cooked mutton biryani.',
        basePrice: 329,
        variants: [
          { name: 'Half', price: 329 },
          { name: 'Full', price: 599 },
        ],
      },
      {
        name: 'Veg Biryani',
        description: 'Basmati rice with mixed vegetables and spices.',
        basePrice: 199,
        isVegetarian: true,
      },
    ],
  },
  {
    name: 'Curries',
    description: 'Gravies best paired with rice or bread.',
    items: [
      {
        name: 'Butter Chicken',
        description: 'Creamy tomato-based chicken curry.',
        basePrice: 260,
      },
      {
        name: 'Dal Tadka',
        description: 'Yellow lentils tempered with spices.',
        basePrice: 160,
        isVegetarian: true,
        isVegan: true,
      },
      {
        name: 'Paneer Butter Masala',
        description: 'Cottage cheese in a rich tomato gravy.',
        basePrice: 230,
        isVegetarian: true,
      },
    ],
  },
  {
    name: 'Breads',
    description: 'Freshly baked breads.',
    items: [
      {
        name: 'Butter Naan',
        description: 'Tandoor-baked leavened bread with butter.',
        basePrice: 45,
        isVegetarian: true,
      },
      {
        name: 'Tandoori Roti',
        description: 'Whole-wheat tandoor bread.',
        basePrice: 30,
        isVegetarian: true,
        isVegan: true,
      },
    ],
  },
  {
    name: 'Beverages & Desserts',
    description: 'Drinks and something sweet to finish.',
    items: [
      {
        name: 'Masala Chai',
        description: 'Spiced Indian tea.',
        basePrice: 40,
        isVegetarian: true,
      },
      {
        name: 'Gulab Jamun',
        description: 'Deep-fried dough balls soaked in sugar syrup.',
        basePrice: 90,
        isVegetarian: true,
      },
      {
        name: 'Fresh Lime Soda',
        description: 'Refreshing lime and soda.',
        basePrice: 60,
        isVegetarian: true,
        isVegan: true,
      },
    ],
  },
];
