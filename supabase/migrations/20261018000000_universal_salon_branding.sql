-- Universal branding fields shared by every registered Nexora template.
-- Profile ownership remains enforced by the existing `profiles_*_owner` RLS policies.
alter table public.profiles
  add column if not exists primary_color text,
  add column if not exists secondary_color text,
  add column if not exists background_color text,
  add column if not exists heading_style text check (heading_style is null or heading_style in ('classic', 'modern', 'editorial', 'bold')),
  add column if not exists button_style text check (button_style is null or button_style in ('rounded', 'pill', 'square', 'soft')),
  add column if not exists border_radius text check (border_radius is null or border_radius in ('none', 'small', 'medium', 'large')),
  add column if not exists appearance text check (appearance is null or appearance in ('light', 'dark', 'system')),
  add column if not exists seo_title text,
  add column if not exists seo_description text;

comment on column public.profiles.primary_color is 'Owner-controlled universal primary brand color.';
comment on column public.profiles.seo_title is 'Owner-controlled page title for the published salon website.';
