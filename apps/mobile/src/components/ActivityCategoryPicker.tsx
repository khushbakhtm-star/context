import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../appearance';
import { createCategory, updateCategory } from '../services/categories';
import type { ActivityCategory, AppColors } from '../theme';
import { isAllowedGoogleActivityColor, isSelectableActivityCategory } from '../utils/google-activity-colors';

const HEX = /^#[0-9a-f]{6}$/i;
type CategoryForm = { mode: 'create' | 'custom' | 'label' | 'rename'; category?: ActivityCategory };

/** Generated palette placeholders are not labels. Deliberate names keep their exact identity. */
export function categoryPickerHasLabel(category: ActivityCategory): boolean {
  if (category.id.startsWith('custom_')) return true;
  const name = category.name.trim();
  if (/^google_palette_[0-9a-f]{6}$/i.test(category.id) && name.toUpperCase() === category.color.toUpperCase()) return false;
  if (category.providerOriginalName && category.providerOriginalName !== category.name) return true;
  const generatedGoogle = category.provider === 'google' && !category.providerLabelId && !category.providerCategoryName &&
    (category.providerColorId || !category.calendarId && /^Google calendar color [A-Za-z0-9_-]+$/.test(name));
  const generatedDevice = category.provider === 'device' && category.providerColorId;
  if (generatedGoogle || generatedDevice) return name.toUpperCase() !== category.color.toUpperCase() &&
    !/^Google (?:event|calendar) color [A-Za-z0-9_-]+$/.test(name);
  return true;
}

function CategoryRainbow() {
  return <View accessible={false} pointerEvents="none" style={{ width: 24, height: 15, overflow: 'hidden' }}>
    {['#BE5661', '#C48C4B', '#C0AE61', '#6B9977', '#7774A6'].map((color, index) => <View key={color}
      style={{ position: 'absolute', left: index * 2, top: index * 2, width: 24 - index * 4, height: 24 - index * 4,
        borderWidth: 2, borderColor: color, borderRadius: 12 - index * 2 }} />)}
  </View>;
}

export type ActivityCategoryPickerProps = {
  visible: boolean;
  selectedId?: string;
  colorChoices: readonly ActivityCategory[];
  busy?: boolean;
  onClose: () => void;
  onSelect: (categoryId: string) => void | Promise<void>;
  onCategoriesChanged?: () => void | Promise<void>;
};

/** Choosing a category changes its assignment only; the caller owns the guarded cell command. */
export function ActivityCategoryPicker({ visible, selectedId, colorChoices, busy = false,
  onClose, onSelect, onCategoriesChanged }: ActivityCategoryPickerProps) {
  const { colors, resolvedMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const mounted = useRef(true), sequence = useRef(0), saving = useRef(false);
  const saved = useRef<{ signature: string; id: string } | null>(null);
  const [form, setForm] = useState<CategoryForm | null>(null), [name, setName] = useState(''), [color, setColor] = useState('');
  const [working, setWorking] = useState(false), [error, setError] = useState<string | null>(null);
  const categories = useMemo(() => {
    const values = colorChoices.filter((category) => isSelectableActivityCategory(category, colorChoices));
    return values.filter((category) => !/^google_palette_[0-9a-f]{6}$/i.test(category.id) || categoryPickerHasLabel(category) ||
      !values.some((other) => other.id !== category.id && !/^google_palette_[0-9a-f]{6}$/i.test(other.id) &&
        !categoryPickerHasLabel(other) && other.color.toUpperCase() === category.color.toUpperCase()));
  }, [colorChoices]);
  const palette = useMemo(() => [...new Set(categories.map((category) => category.color.toUpperCase()))], [categories]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; }; }, []);
  useEffect(() => {
    sequence.current++; saving.current = false; saved.current = null;
    setForm(null); setName(''); setWorking(false); setError(null);
    setColor(categories.find((category) => category.id === selectedId)?.color.toUpperCase() ?? palette[0] ?? '');
    // Palette refreshes must not erase a name that is being entered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  useEffect(() => { if (!color && palette[0] && form?.mode !== 'custom') setColor(palette[0]); }, [color, palette, form?.mode]);
  const disabled = busy || working;
  const canSave = Boolean(form && name.trim() && name.trim().length <= 200 &&
    (form.mode === 'custom' ? HEX.test(color) : form.category ? HEX.test(form.category.color) : palette.includes(color)));
  const close = () => { if (!busy && !saving.current) onClose(); };
  function openForm(mode: CategoryForm['mode'], category?: ActivityCategory) {
    if (busy || saving.current) return;
    saved.current = null; setError(null); setForm({ mode, ...(category ? { category } : {}) });
    setName(mode === 'rename' ? category?.name ?? '' : '');
    setColor(category?.color.toUpperCase() ?? categories.find((value) => value.id === selectedId)?.color.toUpperCase() ?? palette[0] ?? '');
  }
  async function select(id: string) {
    if (busy || saving.current || !categories.some((category) => category.id === id)) return;
    const ticket = ++sequence.current; saving.current = true; setWorking(true); setError(null); Keyboard.dismiss();
    try {
      await onSelect(id);
      if (mounted.current && ticket === sequence.current) onClose();
    } catch (failure) {
      if (mounted.current && ticket === sequence.current) setError(failure instanceof Error ? failure.message : 'The category could not be applied.');
    } finally {
      if (mounted.current && ticket === sequence.current) { saving.current = false; setWorking(false); }
    }
  }
  async function save() {
    if (busy || saving.current || !canSave || !form) return;
    const ticket = ++sequence.current; saving.current = true; setWorking(true); setError(null); Keyboard.dismiss();
    const requested = { name: name.trim(), color: color.toUpperCase() };
    const signature = JSON.stringify([form.mode, form.category?.id, requested]);
    try {
      const prior = saved.current;
      const category = prior?.signature === signature ? prior : form.category
        ? await updateCategory(form.category.id, { name: requested.name })
        : await createCategory({ ...requested, ...(form.mode === 'custom' || !isAllowedGoogleActivityColor(requested.color, colorChoices)
          ? { customColor: true } : {}) });
      if (!mounted.current || ticket !== sequence.current) return;
      // If assignment or refresh fails after creation, retry the saved category rather
      // than creating another category with the same name on each Save tap.
      const id = form.category?.id ?? category.id;
      saved.current = { signature, id };
      await onCategoriesChanged?.();
      if (!mounted.current || ticket !== sequence.current) return;
      await onSelect(id);
      if (mounted.current && ticket === sequence.current) onClose();
    } catch (failure) {
      if (mounted.current && ticket === sequence.current) setError(failure instanceof Error ? failure.message : 'The category could not be saved.');
    } finally {
      if (mounted.current && ticket === sequence.current) { saving.current = false; setWorking(false); }
    }
  }
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <View accessibilityViewIsModal onAccessibilityEscape={close} style={styles.card}>
        <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>Categorize</Text>
          {!form ? <Pressable accessibilityRole="button" accessibilityLabel="Custom category color" disabled={disabled}
            onPress={() => openForm('custom')} style={[styles.close, disabled && styles.disabled]}><CategoryRainbow /></Pressable> : null}
          {!form ? <Pressable accessibilityRole="button" accessibilityLabel="Add category" disabled={disabled}
            onPress={() => openForm('create')} style={[styles.close, disabled && styles.disabled]}>
            <Text allowFontScaling={false} style={styles.plus}>+</Text>
          </Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel="Close categories" disabled={disabled} onPress={close} style={styles.close}>
            <Text allowFontScaling={false} style={styles.closeText}>×</Text>
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="always" style={styles.scroll} contentContainerStyle={styles.content}>
          {form ? <>
            <Text accessibilityRole="header" style={styles.formTitle}>{form.mode === 'rename' ? 'Rename category' :
              form.mode === 'label' ? 'Name category' : form.mode === 'custom' ? 'Custom color' : 'Add category'}</Text>
            <TextInput accessibilityLabel="Category name" keyboardAppearance={resolvedMode} editable={!disabled}
              placeholder="Category name" placeholderTextColor={colors.muted} maxLength={200} value={name}
              onChangeText={setName} style={styles.input} />
            <Text style={styles.label}>Color</Text>
            {form.mode === 'custom' ? <View style={styles.customColor}>
              <View style={[styles.colorDot, { backgroundColor: HEX.test(color) ? color : colors.silver }]} />
              <TextInput accessibilityLabel="Custom category hexadecimal color" keyboardAppearance={resolvedMode} editable={!disabled}
                placeholder="#RRGGBB" placeholderTextColor={colors.muted} maxLength={7} autoCapitalize="characters" autoCorrect={false}
                value={color} onChangeText={(value) => setColor(value.toUpperCase())} style={[styles.input, { flex: 1 }]} />
            </View> : form.category ? <View style={styles.customColor}>
              <View style={[styles.colorDot, { backgroundColor: form.category.color }]} />
              {form.mode === 'rename' ? <Text style={styles.help}>Renaming updates this label everywhere it is used.</Text> : null}
            </View> : <View accessibilityRole="radiogroup" accessibilityLabel="New category colors" style={styles.palette}>
              {palette.map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={`Use category color ${value}`}
                accessibilityState={{ checked: color === value, disabled }} disabled={disabled}
                onPress={() => setColor(value)}
                style={[styles.colorChoice, color === value && styles.selectedColor, disabled && styles.disabled]}>
                <View style={[styles.colorDot, { backgroundColor: value }]} />
              </Pressable>)}
            </View>}
            {form.mode === 'create' ? <Pressable accessibilityRole="button" accessibilityLabel="Use custom category color" disabled={disabled}
              onPress={() => { setForm({ mode: 'custom' }); setError(null); }} style={styles.customLink}>
              <CategoryRainbow /><Text style={styles.actionText}>Custom color</Text></Pressable> : null}
            {form.mode === 'create' && !palette.length ? <Text style={styles.help}>Choose a custom color or wait for calendar colors.</Text> : null}
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" accessibilityLabel="Use existing categories" disabled={disabled}
                onPress={() => { setForm(null); setError(null); }} style={styles.action}>
                <Text style={styles.actionText}>Use existing</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Save and use category" disabled={disabled || !canSave}
                accessibilityState={{ disabled: disabled || !canSave, busy: working }} onPress={() => void save()}
                style={[styles.action, (disabled || !canSave) && styles.disabled]}>
                <Text style={styles.actionText}>{working ? 'Saving…' : 'Save category'}</Text>
              </Pressable>
            </View>
          </> : <>
            <View accessibilityRole="radiogroup" accessibilityLabel="Activity categories">
              {categories.map((category) => {
                const labeled = categoryPickerHasLabel(category);
                return <Pressable key={category.id} accessibilityRole="radio"
                  accessibilityLabel={labeled ? `${category.name}, ${category.color.toUpperCase()}` : `Name color ${category.color.toUpperCase()}`}
                  accessibilityHint={labeled ? 'Tap to use this category. Hold to rename it.' : 'Add a label before using this color.'}
                  accessibilityActions={labeled ? [{ name: 'longpress', label: 'Rename category' }] : []}
                  onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'longpress') openForm('rename', category); }}
                  accessibilityState={{ checked: selectedId === category.id, disabled }} disabled={disabled}
                  onLongPress={labeled ? () => openForm('rename', category) : undefined}
                  onPress={() => labeled ? void select(category.id) : openForm('label', category)}
                  style={[styles.categoryRow, disabled && styles.disabled]}>
                  <View style={[styles.dot, { backgroundColor: category.color }]} />
                  {labeled ? <Text style={styles.categoryName}>{category.name}</Text> : <View style={{ flex: 1 }} />}
                  {selectedId === category.id ? <Text allowFontScaling={false} style={styles.check}>✓</Text> : null}
                </Pressable>;
              })}
            </View>
            {!categories.length ? <Text style={styles.help}>No categories are available for these cells yet.</Text> : null}
          </>}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  overlay: { flex: 1, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.scrim },
  card: { width: '100%', maxWidth: 520, maxHeight: '100%', flexShrink: 1, borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline, backgroundColor: colors.paper, overflow: 'hidden' },
  heading: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 4 },
  title: { flex: 1, fontSize: 18, fontWeight: '600', color: colors.ink }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.muted, fontSize: 27 }, scroll: { flexShrink: 1 }, content: { paddingHorizontal: 18, paddingBottom: 16 },
  categoryRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: colors.swatchBorder },
  categoryName: { flex: 1, color: colors.ink, fontSize: 15, lineHeight: 21 }, check: { color: colors.ink, fontSize: 17 },
  plus: { color: colors.ink, fontSize: 25 },
  actionText: { color: colors.ink, fontSize: 14, fontWeight: '500' }, formTitle: { color: colors.ink, fontSize: 15, marginBottom: 8 },
  input: { minHeight: 44, color: colors.ink, fontSize: 15, padding: 10, borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline, borderRadius: 8 }, label: { color: colors.muted, fontSize: 13, marginTop: 16, marginBottom: 8 },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 }, colorChoice: { width: 64, minHeight: 58, padding: 5,
    alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: 'transparent', borderRadius: 7 },
  selectedColor: { borderColor: colors.ink }, colorDot: { width: 25, height: 25, borderRadius: 13, borderWidth: 1, borderColor: colors.swatchBorder },
  customColor: { flexDirection: 'row', alignItems: 'center', gap: 12 }, customLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  action: { minHeight: 44, paddingHorizontal: 6, justifyContent: 'center' }, help: { color: colors.muted, fontSize: 13, lineHeight: 19, paddingVertical: 12 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19, marginTop: 12 }, disabled: { opacity: 0.45 },
});
