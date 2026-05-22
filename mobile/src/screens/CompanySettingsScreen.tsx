import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { myCompanyApi } from '../api/services';
import AnimatedCard from '../components/AnimatedCard';
import IosScreenHeader from '../components/IosScreenHeader';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import type { Tenant } from '../../../shared/types';
import { formatPhone } from '../../../shared/validation/phone';

interface CompanyForm {
  name: string;
  phone: string;
  address: string;
  email: string;
  description: string;
  legalName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  receiptFooter: string;
}

export default function CompanySettingsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const palette = useColors();

  const { data: company, isLoading } = useQuery<Tenant>({
    queryKey: ['my-company'],
    queryFn: async () => (await myCompanyApi.get()).data,
  });

  const [form, setForm] = useState<CompanyForm>({
    name: '',
    phone: '',
    address: '',
    email: '',
    description: '',
    legalName: '',
    inn: '',
    kpp: '',
    ogrn: '',
    receiptFooter: '',
  });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (company) {
      setForm({
        name: company.name || '',
        phone: company.phone || '',
        address: company.address || '',
        email: company.email || '',
        description: company.description || '',
        legalName: company.legalName || '',
        inn: company.inn || '',
        kpp: company.kpp || '',
        ogrn: company.ogrn || '',
        receiptFooter: company.receiptFooter || '',
      });
      setDirty(false);
    }
  }, [company]);

  const mutation = useMutation({
    mutationFn: (data: Partial<Tenant>) => myCompanyApi.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-company'] });
      Alert.alert('Готово', 'Настройки сохранены');
      setDirty(false);
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось сохранить'),
  });

  const update = (patch: Partial<CompanyForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const handleSave = () => {
    mutation.mutate({
      name: form.name || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      email: form.email || undefined,
      description: form.description || undefined,
      legalName: form.legalName || undefined,
      inn: form.inn || undefined,
      kpp: form.kpp || undefined,
      ogrn: form.ogrn || undefined,
      receiptFooter: form.receiptFooter || undefined,
    });
  };

  if (isLoading) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Настройки компании" onBack={() => navigation.goBack()} />
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary[600]} />
      </View>
    );
  }

  const cardStyle = StyleSheet.flatten([
    styles.card,
    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
  ]);
  const cardTitleStyle = StyleSheet.flatten([styles.cardTitle, { color: palette.text.primary }]);
  const labelStyle = StyleSheet.flatten([styles.label, { color: palette.text.secondary }]);
  const inputStyle = StyleSheet.flatten([
    styles.input,
    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
  ]);
  const placeholderColor = palette.text.tertiary;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Настройки компании" onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}>
          {/* Basic info */}
          <AnimatedCard index={0}>
            <View style={cardStyle}>
              <View style={styles.cardHeader}>
                <Ionicons name="business-outline" size={16} color={palette.text.tertiary} />
                <Text style={cardTitleStyle}>Основные данные</Text>
              </View>

              <View style={styles.field}>
                <Text style={labelStyle}>Название компании</Text>
                <TextInput
                  value={form.name}
                  onChangeText={(v) => update({ name: v })}
                  style={inputStyle}
                  placeholder="Автосервис «Мастер»"
                  placeholderTextColor={placeholderColor}
                />
              </View>

              <View style={styles.rowFields}>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>Телефон</Text>
                  {/* Phone mask shared with LoginScreen — user types digits,
                      formatPhone re-formats to +7 (XXX) XXX-XX-XX live. */}
                  <TextInput
                    value={form.phone}
                    onChangeText={(v) => update({ phone: formatPhone(v.replace(/\D/g, '')) })}
                    style={inputStyle}
                    placeholder="+7 (___) ___-__-__"
                    placeholderTextColor={placeholderColor}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>Email</Text>
                  <TextInput
                    value={form.email}
                    onChangeText={(v) => update({ email: v })}
                    style={inputStyle}
                    placeholder="info@autoservice.ru"
                    placeholderTextColor={placeholderColor}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={labelStyle}>Адрес</Text>
                <TextInput
                  value={form.address}
                  onChangeText={(v) => update({ address: v })}
                  style={inputStyle}
                  placeholder="г. Москва, ул. Примерная, д. 1"
                  placeholderTextColor={placeholderColor}
                />
              </View>

              <View style={styles.field}>
                <Text style={labelStyle}>Описание</Text>
                <TextInput
                  value={form.description}
                  onChangeText={(v) => update({ description: v })}
                  style={[inputStyle, styles.textarea]}
                  placeholder="Краткое описание автосервиса"
                  placeholderTextColor={placeholderColor}
                  multiline
                  numberOfLines={2}
                />
              </View>
            </View>
          </AnimatedCard>

          {/* Receipt / Legal */}
          <AnimatedCard index={1}>
            <View style={cardStyle}>
              <View style={styles.cardHeader}>
                <Ionicons name="receipt-outline" size={16} color={palette.text.tertiary} />
                <Text style={cardTitleStyle}>Реквизиты для чеков</Text>
              </View>

              <View style={styles.field}>
                <Text style={labelStyle}>Юридическое название</Text>
                <TextInput
                  value={form.legalName}
                  onChangeText={(v) => update({ legalName: v })}
                  style={inputStyle}
                  placeholder="ИП Иванов И.И. или ООО «Мастер»"
                  placeholderTextColor={placeholderColor}
                />
              </View>

              <View style={styles.rowFields3}>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>ИНН</Text>
                  <TextInput
                    value={form.inn}
                    onChangeText={(v) => update({ inn: v.replace(/\D/g, '').slice(0, 12) })}
                    style={inputStyle}
                    placeholder="1234567890"
                    placeholderTextColor={placeholderColor}
                    keyboardType="numeric"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>КПП</Text>
                  <TextInput
                    value={form.kpp}
                    onChangeText={(v) => update({ kpp: v.replace(/\D/g, '').slice(0, 9) })}
                    style={inputStyle}
                    placeholder="123456789"
                    placeholderTextColor={placeholderColor}
                    keyboardType="numeric"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>ОГРН</Text>
                  <TextInput
                    value={form.ogrn}
                    onChangeText={(v) => update({ ogrn: v.replace(/\D/g, '').slice(0, 15) })}
                    style={inputStyle}
                    placeholder="1234567890123"
                    placeholderTextColor={placeholderColor}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={labelStyle}>Текст внизу чека</Text>
                <TextInput
                  value={form.receiptFooter}
                  onChangeText={(v) => update({ receiptFooter: v })}
                  style={[inputStyle, styles.textarea]}
                  placeholder="Спасибо за визит! Ждём вас снова!"
                  placeholderTextColor={placeholderColor}
                  multiline
                  numberOfLines={2}
                />
                <Text style={[styles.hint, { color: palette.text.tertiary }]}>
                  Этот текст печатается внизу каждого чека
                </Text>
              </View>
            </View>
          </AnimatedCard>

          {/* Save */}
          {dirty && (
            <AnimatedCard index={2}>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={mutation.isPending}>
                {mutation.isPending ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={18} color={colors.white} />
                    <Text style={styles.saveBtnText}>Сохранить настройки</Text>
                  </>
                )}
              </TouchableOpacity>
            </AnimatedCard>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  scrollContent: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[8] },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[5],
    gap: spacing[4],
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  cardTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  field: { gap: spacing[1] },
  label: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[600] },
  input: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
  },
  textarea: { minHeight: 60, textAlignVertical: 'top' },
  hint: { fontSize: 11, color: colors.gray[400], marginTop: 4 },
  rowFields: { flexDirection: 'row', gap: spacing[3] },
  rowFields3: { flexDirection: 'row', gap: spacing[2] },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.primary[600],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[4],
  },
  saveBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.white },
});
