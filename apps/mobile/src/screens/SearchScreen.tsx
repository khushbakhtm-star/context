import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { searchEntries } from '../data/database';
import { colors } from '../theme';
import type { SearchResult } from '../types';
import { formatCompactDate, minuteLabel } from '../utils/time';

type Props = {
  dataVersion: number;
  onOpenResult: (result: SearchResult) => void;
};

export function SearchScreen({ dataVersion, onOpenResult }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void searchEntries(query.trim(), 150).then(setResults);
    }, 180);
    return () => clearTimeout(timer);
  }, [dataVersion, query]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>HISTORY</Text>
        <Text style={styles.title}>Find any remembered minute</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search thoughts, decisions, people, work…"
          placeholderTextColor="#96938C"
          clearButtonMode="while-editing"
          returnKeyType="search"
          style={styles.search}
        />
      </View>
      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={results.length ? styles.list : styles.emptyList}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing recorded here yet</Text>
            <Text style={styles.emptyBody}>Every minute you save becomes searchable history.</Text>
          </View>
        }
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

const styles = StyleSheet.create({
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
    backgroundColor: colors.white,
    fontSize: 15,
  },
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
    backgroundColor: colors.white,
  },
  resultBar: { width: 5 },
  resultBody: { flex: 1, padding: 13 },
  resultText: { color: colors.ink, fontSize: 14, fontWeight: '500', lineHeight: 20 },
  resultMeta: { marginTop: 5, color: colors.muted, fontSize: 11 },
});
