import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Building2,
  Phone,
  MapPin,
  Mail,
  FileText,
  Save,
  Loader2,
  Receipt,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { myCompanyApi } from '../api/services';
import type { Tenant } from '../types';

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

export default function CompanySettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
      toast.success('Настройки сохранены');
      setDirty(false);
    },
    onError: () => toast.error('Ошибка сохранения'),
  });

  const update = (patch: Partial<CompanyForm>) => {
    setForm(prev => ({ ...prev, ...patch }));
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
      <div className="flex justify-center py-16">
        <Loader2 className="h-7 w-7 animate-spin text-gray-300" />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-2xl mx-auto pb-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-ghost btn-sm">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Настройки компании</h1>
          <p className="text-sm text-gray-500">Реквизиты и данные для чеков</p>
        </div>
      </div>

      {/* Company info */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Building2 className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900">Основные данные</h2>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Название компании</label>
          <input
            value={form.name}
            onChange={e => update({ name: e.target.value })}
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none transition-all"
            placeholder="Автосервис «Мастер»"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">
              <Phone className="h-3 w-3 inline mr-1" />Телефон
            </label>
            <input
              value={form.phone}
              onChange={e => update({ phone: e.target.value })}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none transition-all"
              placeholder="+7 (999) 123-45-67"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">
              <Mail className="h-3 w-3 inline mr-1" />Email
            </label>
            <input
              value={form.email}
              onChange={e => update({ email: e.target.value })}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none transition-all"
              placeholder="info@autoservice.ru"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">
            <MapPin className="h-3 w-3 inline mr-1" />Адрес
          </label>
          <input
            value={form.address}
            onChange={e => update({ address: e.target.value })}
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none transition-all"
            placeholder="г. Москва, ул. Примерная, д. 1"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Описание</label>
          <textarea
            value={form.description}
            onChange={e => update({ description: e.target.value })}
            rows={2}
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm resize-none focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none transition-all"
            placeholder="Краткое описание вашего автосервиса"
          />
        </div>
      </div>

      {/* Receipt / legal details */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Receipt className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900">Реквизиты для чеков</h2>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Юридическое название</label>
          <input
            value={form.legalName}
            onChange={e => update({ legalName: e.target.value })}
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none transition-all"
            placeholder='ИП Иванов И.И. или ООО «Мастер»'
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">ИНН</label>
            <input
              value={form.inn}
              onChange={e => update({ inn: e.target.value.replace(/\D/g, '').slice(0, 12) })}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none transition-all"
              placeholder="1234567890"
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">КПП</label>
            <input
              value={form.kpp}
              onChange={e => update({ kpp: e.target.value.replace(/\D/g, '').slice(0, 9) })}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none transition-all"
              placeholder="123456789"
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">ОГРН</label>
            <input
              value={form.ogrn}
              onChange={e => update({ ogrn: e.target.value.replace(/\D/g, '').slice(0, 15) })}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none transition-all"
              placeholder="1234567890123"
              inputMode="numeric"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">
            <FileText className="h-3 w-3 inline mr-1" />Текст внизу чека
          </label>
          <textarea
            value={form.receiptFooter}
            onChange={e => update({ receiptFooter: e.target.value })}
            rows={2}
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm resize-none focus:border-primary-300 focus:ring-1 focus:ring-primary-200 outline-none transition-all"
            placeholder="Спасибо за визит! Ждём вас снова!"
          />
          <p className="text-xs text-gray-400 mt-1">Этот текст будет печататься внизу каждого чека</p>
        </div>
      </div>

      {/* Save */}
      {dirty && (
        <button
          onClick={handleSave}
          disabled={mutation.isPending}
          className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white rounded-xl py-3.5 text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors shadow-sm"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Сохранить настройки
        </button>
      )}
    </div>
  );
}
