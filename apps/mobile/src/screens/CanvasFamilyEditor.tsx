import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';
import { CANVAS_FAMILY_LABEL_LIMIT, type CanvasFamily, type CanvasFamilyPersonInput, type CanvasNode } from '../utils/canvas';

type PersonKind = Extract<CanvasFamilyPersonInput, { kind: string }>['kind'];
type PersonDraft = { key: number; name: string; kind: PersonKind; existingId?: string };
export type FamilyForm = {
  id?: string;
  parents: [CanvasFamilyPersonInput, CanvasFamilyPersonInput];
  children: CanvasFamilyPersonInput[];
  consanguineous: boolean;
  relationshipLabel: string;
};

const SYMBOLS: { kind: PersonKind; glyph: string; name: string }[] = [
  { kind: 'person-circle', glyph: '○', name: 'Female' },
  { kind: 'person-square', glyph: '□', name: 'Male' },
  { kind: 'person-diamond', glyph: '◇', name: 'Unknown' },
];

function newPerson(key: number, kind: PersonKind = 'person-diamond', existingId?: string): PersonDraft {
  return { key, kind, existingId, name: '' };
}

function toPerson({ name, kind, existingId }: PersonDraft): CanvasFamilyPersonInput {
  return existingId ? { id: existingId } : { name: name.trim(), kind };
}

function Action({ label, text = label, onPress, disabled, selected, styles }: {
  label: string; text?: string; onPress: () => void; disabled?: boolean; selected?: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }}
    disabled={disabled} onPress={onPress}
    style={[styles.action, selected && styles.selected, disabled && styles.disabled]}>
    <Text style={styles.actionText}>{text}</Text>
  </Pressable>;
}

export function CanvasFamilyEditor({ family, people, seedPersonId, onSave, onManage, onRemove }: {
  family?: CanvasFamily;
  people: CanvasNode[];
  seedPersonId?: string;
  onSave: (form: FamilyForm) => void;
  onManage?: () => void;
  onRemove?: () => void;
}) {
  const { colors, resolvedMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [parents, setParents] = useState<[PersonDraft, PersonDraft]>(() => [
    newPerson(0, 'person-square', family?.parents[0] ?? seedPersonId), newPerson(1, 'person-circle', family?.parents[1]),
  ]);
  const [children, setChildren] = useState(() => (family?.children ?? []).map((id, index) => newPerson(index + 2, 'person-diamond', id)));
  const nextKey = useRef(children.length + 2);
  const [consanguineous, setConsanguineous] = useState(Boolean(family?.consanguineous));
  const [relationshipLabel, setRelationshipLabel] = useState(family?.relationshipLabel ?? '');
  const [picker, setPicker] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const selectedIds = new Set([...parents, ...children].flatMap(({ existingId }) => existingId ? [existingId] : []));
  const allNamed = [...parents, ...children].every(({ existingId, name }) => existingId ? peopleById.has(existingId) : name.trim());
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = people.filter((person) => !selectedIds.has(person.id) && person.text.toLocaleLowerCase().includes(normalizedQuery));

  function patchPerson(key: number, patch: Partial<PersonDraft>) {
    const update = (person: PersonDraft) => person.key === key ? { ...person, ...patch } : person;
    if (key < 2) setParents(([first, second]) => [update(first), update(second)]);
    else setChildren((current) => current.map(update));
  }

  function moveChild(index: number, step: number) {
    setChildren((current) => {
      const to = index + step;
      if (to < 0 || to >= current.length) return current;
      const reordered = current.slice();
      [reordered[index], reordered[to]] = [reordered[to]!, reordered[index]!];
      return reordered;
    });
  }

  function renderPerson(person: PersonDraft, label: string, index?: number) {
    const existing = person.existingId ? peopleById.get(person.existingId) : undefined;
    const selectionOpen = picker === person.key;
    return <View key={person.key} style={styles.person}>
      <View style={styles.row}>
        <Text style={styles.personLabel}>{label}</Text>
        {index !== undefined ? <>
          <Action label={label + ' earlier'} text="↑" onPress={() => moveChild(index, -1)} disabled={!index} styles={styles} />
          <Action label={label + ' later'} text="↓" onPress={() => moveChild(index, 1)}
            disabled={index === children.length - 1} styles={styles} />
          <Action label={'Remove ' + label.toLowerCase()} text="×" styles={styles} onPress={() => {
            setChildren((current) => current.filter(({ key }) => key !== person.key));
            if (selectionOpen) setPicker(null);
          }} />
        </> : null}
      </View>
      {existing ? <View style={styles.row}>
        <Text style={styles.existing} numberOfLines={2}>
          {SYMBOLS.find(({ kind }) => kind === existing.kind)?.glyph}  {existing.text.trim() || 'Unnamed person'}
        </Text>
        <Action label={'Enter a new person for ' + label.toLowerCase()} text="New person" styles={styles}
          onPress={() => { patchPerson(person.key, { existingId: undefined }); setPicker(null); }} />
      </View> : <>
        <TextInput accessibilityLabel={label + ' name'} placeholder="Name" placeholderTextColor={colors.muted}
          value={person.name} onChangeText={(name) => patchPerson(person.key, { name })} keyboardAppearance={resolvedMode} style={styles.field} />
        <View style={styles.symbolRow}>{SYMBOLS.map(({ kind, glyph, name }) => <Action key={kind}
          label={label + ' symbol, ' + name} text={glyph + '  ' + name} selected={person.kind === kind} styles={styles}
          onPress={() => patchPerson(person.key, { kind })} />)}</View>
      </>}
      {people.length ? <View style={styles.selector}>
        <Action label={'Choose an existing person for ' + label.toLowerCase()} text={selectionOpen ? 'Close people' : 'Choose existing'}
          styles={styles} selected={selectionOpen} onPress={() => { setQuery(''); setPicker(selectionOpen ? null : person.key); }} />
      </View> : null}
      {selectionOpen ? <View style={styles.results}>
        <TextInput accessibilityLabel="Find existing people" placeholder="Find a person" placeholderTextColor={colors.muted}
          value={query} onChangeText={setQuery} keyboardAppearance={resolvedMode} style={styles.field} />
        {matches.slice(0, 12).map((match) => <Pressable key={match.id} accessibilityRole="button" style={styles.result}
          onPress={() => { patchPerson(person.key, { existingId: match.id }); setPicker(null); }}>
          <Text style={styles.actionText} numberOfLines={2}>
            {SYMBOLS.find(({ kind }) => kind === match.kind)?.glyph}  {match.text.trim() || 'Unnamed person'}
          </Text>
        </Pressable>)}
        {!matches.length ? <Text style={styles.hint}>No matching people.</Text> : null}
        {matches.length > 12 ? <Text style={styles.hint}>Search by name to narrow the list.</Text> : null}
      </View> : null}
    </View>;
  }

  return <View style={styles.form}>
    {onManage ? <View style={styles.selector}>
      <Action label="Manage existing families" text="Existing families" styles={styles} onPress={onManage} />
    </View> : null}
    <Text accessibilityRole="header" style={styles.heading}>Parents</Text>
    {parents.map((person, index) => renderPerson(person, 'Parent ' + (index + 1)))}
    <TextInput accessibilityLabel="Relationship label" placeholder="Relationship label (optional)" placeholderTextColor={colors.muted}
      value={relationshipLabel} onChangeText={setRelationshipLabel} maxLength={CANVAS_FAMILY_LABEL_LIMIT}
      keyboardAppearance={resolvedMode} style={styles.field} />
    <View style={styles.toggle}>
      <View style={styles.toggleText}>
        <Text style={styles.actionText}>Consanguineous</Text>
        <Text style={styles.hint}>Related parents are joined by a double line.</Text>
      </View>
      <Switch accessibilityLabel="Consanguineous parents" value={consanguineous} onValueChange={setConsanguineous} />
    </View>
    <Text accessibilityRole="header" style={styles.heading}>Children</Text>
    <Text style={styles.hint}>Oldest first. The diagram shows them from left to right.</Text>
    {children.map((person, index) => renderPerson(person, 'Child ' + (index + 1), index))}
    <View style={styles.selector}>
      <Action label="Add child" text="+ Child" styles={styles} onPress={() => {
        const key = nextKey.current++;
        setChildren((current) => [...current, newPerson(key)]);
      }} />
    </View>
    <View style={styles.footer}>
      {onRemove ? <Action label="Remove family" styles={styles} onPress={onRemove} /> : null}
      <Action label="Save family" styles={styles} disabled={!allNamed} onPress={() => onSave({
        id: family?.id, parents: [toPerson(parents[0]), toPerson(parents[1])],
        children: children.map(toPerson), consanguineous, relationshipLabel: relationshipLabel.trim(),
      })} />
    </View>
  </View>;
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  form: { gap: 8 },
  heading: { color: colors.ink, fontSize: 15, fontWeight: '700', marginTop: 5 },
  person: { paddingHorizontal: 9, paddingBottom: 8, gap: 4, borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline, borderRadius: 8, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 40 },
  personLabel: { flex: 1, color: colors.ink, fontWeight: '600' },
  existing: { flex: 1, color: colors.ink, paddingRight: 4 },
  field: { minHeight: 44, borderWidth: 1, borderColor: colors.hairline, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 5, color: colors.ink, fontSize: 15 },
  symbolRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  action: { minWidth: 40, minHeight: 44, paddingHorizontal: 7, justifyContent: 'center', alignItems: 'center', borderRadius: 6 },
  selected: { backgroundColor: colors.panel, borderColor: colors.hairline, borderWidth: StyleSheet.hairlineWidth },
  disabled: { opacity: 0.4 },
  actionText: { color: colors.ink, fontSize: 14, fontWeight: '500' },
  hint: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  toggleText: { flex: 1 },
  selector: { alignItems: 'flex-start' },
  results: { paddingBottom: 4 },
  result: { minHeight: 44, paddingHorizontal: 5, justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
});
