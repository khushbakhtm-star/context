import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { getAccounts } from '../sync/accounts';
import type { ConnectedAccount } from '../sync/types';
import {
  createCategory, importAccountCategories, importDeviceCategories, listCategories, updateCategory,
} from '../services/categories';
import { colors } from '../theme';
import type { ActivityCategory } from '../theme';
import type { DeviceCalendar } from '../types';

type Props = { onDataChanged: () => void; calendars?: DeviceCalendar[] };

export function CategoriesScreen({ onDataChanged, calendars = [] }: Props) {
  const [categories, setCategories] = useState<ActivityCategory[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#667B69');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [values, connected] = await Promise.all([listCategories(), getAccounts()]);
    setCategories(values);
    setAccounts(connected.filter((account) => account.provider !== 'webdav' && account.consent.calendarRead));
  }, []);
  useEffect(() => { void refresh().catch((failure) => setError(String(failure))); }, [refresh]);

  const visible = useMemo(() => categories.filter((category) =>
    (showArchived || !category.archived) && category.name.toLowerCase().includes(search.toLowerCase())),
  [categories, search, showArchived]);
  const palette = useMemo(() => [...new Set(categories.map((category) => category.color))], [categories]);

  async function perform(action: () => Promise<string | void>) {
    if (busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await action();
      await refresh();
      onDataChanged();
      if (result) setMessage(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Category changes could not be saved.'); }
    finally { setBusy(false); }
  }

  function edit(category: ActivityCategory) {
    setEditing(category.id); setName(category.name); setColor(category.color); setMessage(null); setError(null);
  }

  function save() {
    void perform(async () => {
      if (editing) await updateCategory(editing, { name, color });
      else await createCategory({ name, color });
      setEditing(null); setName('');
      return 'Category saved';
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.eyebrow}>ACTIVITY CATEGORIES</Text>
      <Text style={styles.title}>Your own language for time</Text>
      <Text style={styles.intro}>
        Add as many activity categories as you need. Import the colors and named categories available
        in your connected calendars, then use them throughout your minute ledger.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{editing ? 'Edit category' : 'Create a category'}</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Category name" editable={!busy}
          placeholderTextColor={colors.muted} style={styles.input} maxLength={200} />
        <View style={styles.colorInputRow}>
          <View style={[styles.largeDot, { backgroundColor: /^#[0-9a-f]{6}$/i.test(color) ? color : colors.silver }]} />
          <TextInput value={color} onChangeText={setColor} placeholder="#667B69" editable={!busy}
            autoCapitalize="characters" autoCorrect={false} maxLength={7}
            accessibilityLabel="Category color in hexadecimal" style={[styles.input, styles.colorInput]} />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.palette}>
          {palette.map((value) => <Pressable key={value} onPress={() => setColor(value)} disabled={busy}
            accessibilityLabel={`Use ${value}`} style={[styles.swatch, { backgroundColor: value },
              value.toUpperCase() === color.toUpperCase() && styles.selectedSwatch]} />)}
        </ScrollView>
        <View style={styles.actions}>
          {editing ? <Pressable disabled={busy} onPress={() => { setEditing(null); setName(''); }}>
            <Text style={styles.link}>Cancel edit</Text>
          </Pressable> : <View />}
          <Pressable disabled={busy || !name.trim()} onPress={save}
            style={[styles.button, (busy || !name.trim()) && styles.disabled]}>
            <Text style={styles.buttonText}>{busy ? 'Saving…' : 'Save category'}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Import calendar colors & categories</Text>
        <Text style={styles.help}>
          Provider palettes and labels are imported without a nine-category limit. A calendar's
          color limits still apply when publishing events; several categories may share one color.
        </Text>
        {accounts.map((account) => <Pressable key={account.id} disabled={busy}
          onPress={() => void perform(async () => {
            const result = await importAccountCategories(account);
            return `${result.added} categories added${result.note ? `. ${result.note}` : ''}`;
          })} style={styles.importRow}>
          <Text style={styles.importName}>{account.label}</Text>
          <Text style={styles.link}>Import</Text>
        </Pressable>)}
        {calendars.length ? <Pressable disabled={busy} style={styles.importRow}
          onPress={() => void perform(async () => `${await importDeviceCategories(calendars)} device calendar categories added`)}>
          <Text style={styles.importName}>Calendars on this phone</Text><Text style={styles.link}>Import</Text>
        </Pressable> : null}
        {!accounts.length && !calendars.length ? <Text style={styles.help}>Connect a calendar in Settings to import its categories.</Text> : null}
      </View>

      {message ? <Text style={styles.message}>{message}</Text> : null}
      {error ? <Text selectable style={styles.error}>{error}</Text> : null}

      <View style={styles.listHeading}>
        <Text style={styles.cardTitle}>{categories.filter((category) => !category.archived).length} active categories</Text>
        <View style={styles.archiveToggle}><Text style={styles.help}>Archived</Text>
          <Switch value={showArchived} onValueChange={setShowArchived}
            trackColor={{ false: '#D5D2CB', true: '#7A8079' }} thumbColor={colors.white} /></View>
      </View>
      <TextInput value={search} onChangeText={setSearch} placeholder="Find a category"
        placeholderTextColor={colors.muted} style={styles.input} />
      <View style={styles.card}>
        {visible.map((category) => <View key={category.id} style={styles.categoryRow}>
          <View style={[styles.dot, { backgroundColor: category.color }]} />
          <Pressable onPress={() => edit(category)} disabled={busy} style={styles.categoryCopy}>
            <Text style={styles.categoryName}>{category.name}</Text>
            <Text style={styles.categorySource}>{category.provider ? `${category.provider} · ` : ''}{category.color}{category.archived ? ' · archived' : ''}</Text>
          </Pressable>
          <Pressable disabled={busy} onPress={() => void perform(async () => {
            await updateCategory(category.id, { archived: !category.archived });
          })} style={styles.archiveAction}>
            <Text style={styles.link}>{category.archived ? 'Restore' : 'Archive'}</Text>
          </Pressable>
        </View>)}
        {!visible.length ? <Text style={styles.help}>No matching categories.</Text> : null}
      </View>
      <Text style={styles.help}>
        Archiving hides a category from new entry choices and keeps its history and reports. Local
        display edits keep an imported category's original provider mapping.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper }, content: { padding: 20, paddingBottom: 40 },
  eyebrow: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.1 },
  title: { marginTop: 6, color: colors.ink, fontSize: 28, lineHeight: 34, fontWeight: '700' },
  intro: { marginTop: 9, color: colors.muted, fontSize: 14, lineHeight: 21 },
  card: { marginTop: 18, padding: 16, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline, backgroundColor: colors.white },
  cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  help: { marginTop: 6, color: colors.muted, fontSize: 12, lineHeight: 18 },
  input: { marginTop: 12, padding: 12, borderWidth: 1, borderColor: colors.hairline, borderRadius: 10,
    color: colors.ink, fontSize: 14, backgroundColor: colors.white },
  colorInputRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, colorInput: { flex: 1 },
  largeDot: { width: 28, height: 28, borderRadius: 14, marginTop: 12 },
  palette: { gap: 11, paddingVertical: 14 }, swatch: { width: 24, height: 24, borderRadius: 12 },
  selectedSwatch: { borderWidth: 2, borderColor: colors.ink },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  button: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.ink },
  buttonText: { color: colors.white, fontSize: 13, fontWeight: '700' }, link: { color: colors.graphite, fontSize: 12, fontWeight: '700' },
  importRow: { flexDirection: 'row', alignItems: 'center', paddingTop: 15, gap: 10 },
  importName: { flex: 1, color: colors.graphite, fontSize: 13 },
  message: { marginTop: 14, color: colors.success, fontSize: 13, lineHeight: 19 },
  error: { marginTop: 14, color: colors.danger, fontSize: 13, lineHeight: 19 },
  listHeading: { marginTop: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  archiveToggle: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  categoryRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  dot: { width: 12, height: 12, borderRadius: 6, marginRight: 12 }, categoryCopy: { flex: 1, paddingVertical: 10 },
  categoryName: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  categorySource: { marginTop: 3, color: colors.muted, fontSize: 10 }, archiveAction: { paddingVertical: 12, paddingLeft: 12 },
  disabled: { opacity: 0.4 },
});
