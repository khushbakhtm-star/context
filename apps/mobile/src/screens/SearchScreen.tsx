import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { searchEntries } from '../data/database';
import { useAppTheme } from '../appearance';
import type { AppColors } from '../theme';
import type { SearchResult } from '../types';
import { formatCompactDate, minuteLabel } from '../utils/time';

type Props = {
  dataVersion: number;
  onOpenResult: (result: SearchResult) => void;
};

export function SearchScreen({ dataVersion, onOpenResult }: Props) {
  const { colors, resolvedMode } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(true);
  const [searchError, setSearchError] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    let current = true;
    setResults([]);
    setSearching(true);
    setSearchError(false);
    const timer = setTimeout(() => {
      void searchEntries(query.trim(), 150).then((next) => {
        if (!current) return;
        setResults(next);
        setSearching(false);
      }).catch(() => {
        if (!current) return;
        setResults([]);
        setSearching(false);
        setSearchError(true);
      });
    }, 180);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [dataVersion, query, retryVersion]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>HISTORY</Text>
        <Text style={styles.title}>Find any remembered minute</Text>
        <TextInput keyboardAppearance={resolvedMode}
          value={query}
          onChangeText={setQuery}
          placeholder="Search thoughts, decisions, people, work…"
          placeholderTextColor={colors.muted}
          clearButtonMode="while-editing"
          returnKeyType="search"
          style={styles.search}
        />
        {searchError ? (
          <View style={styles.errorRow}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              Your history could not be searched. Try again.
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setRetryVersion((value) => value + 1)}
              style={styles.retryButton}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={results.length ? styles.list : styles.emptyList}
        ListEmptyComponent={searchError ? undefined : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>
              {searching ? 'Searching your history…' : 'Nothing recorded here yet'}
            </Text>
            {!searching ? (
              <Text style={styles.emptyBody}>Every minute you save becomes searchable history.</Text>
            ) : null}
          </View>
        )}
        renderItem={({ item }) => (
          <Pressable onPress={() => onOpenResult(item)} style={styles.result}>
            <View style={[styles.resultBar, { backgroundColor: item.categoryColor }]} />
            <View style={styles.resultBody}>
              <Text numberOfLines={2} style={styles.resultText}>{item.text}</Text>
              <Text style={styles.resultMeta}>
                {formatCompactDate(item.dateKey)} · {minuteLabel(item.minuteIndex, true)} ·{' '}
                {item.categoryName}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const createStyles = (colors: AppColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12 },
  eyebrow: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.1 },
  title: { marginTop: 5, color: colors.ink, fontSize: 25, fontWeight: '700' },
  search: {
    height: 48,
    marginTop: 18,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: 12,
    color: colors.ink,
    backgroundColor: colors.surface,
    fontSize: 15,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  errorText: { flex: 1, color: colors.danger, fontSize: 13, lineHeight: 18 },
  retryButton: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center',
    borderWidth: 1, borderColor: colors.hairline, borderRadius: 10, backgroundColor: colors.surface },
  retryText: { color: colors.graphite, fontSize: 13, fontWeight: '600' },
  list: { paddingHorizontal: 20, paddingBottom: 30 },
  emptyList: { flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyTitle: { color: colors.graphite, fontSize: 15, fontWeight: '700' },
  emptyBody: { marginTop: 6, color: colors.muted, fontSize: 13, textAlign: 'center' },
  result: {
    minHeight: 72,
    flexDirection: 'row',
    overflow: 'hidden',
    marginBottom: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: 12,
    backgroundColor: colors.surface,
  },
  resultBar: { width: 5 },
  resultBody: { flex: 1, padding: 13 },
  resultText: { color: colors.ink, fontSize: 14, fontWeight: '500', lineHeight: 20 },
  resultMeta: { marginTop: 5, color: colors.muted, fontSize: 11 },
});
