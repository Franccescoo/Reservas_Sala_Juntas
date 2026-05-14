import { Injectable } from '@angular/core';
import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

import { environment } from '../../environments/environment';

export interface ReservaSala {
  id?: string;
  sala_id?: string;
  nombre: string;
  departamento: string;
  motivo?: string | null;
  fecha_inicio: string;
  fecha_fin: string;
  estado?: 'reservado' | 'cancelado' | string;
  created_at?: string;
}

@Injectable({
  providedIn: 'root',
})
export class ReservasService {
  private readonly minutosSeparacionEntreReservas = 20;
  private supabase: SupabaseClient | null = null;
  private realtimeChannel: RealtimeChannel | null = null;

  async obtenerReservas(): Promise<ReservaSala[]> {
    const { data, error } = await this.client
      .from('reservas')
      .select('*')
      .eq('estado', 'reservado')
      .order('fecha_inicio', { ascending: true });

    if (error) {
      throw error;
    }

    return data ?? [];
  }

  async crearReserva(reserva: ReservaSala): Promise<ReservaSala> {
    const existeChoque = await this.validarChoqueHorario(reserva.fecha_inicio, reserva.fecha_fin);

    if (existeChoque) {
      throw new Error('Ya existe una reserva en ese rango horario o dentro del margen de 20 minutos.');
    }

    const { data, error } = await this.client
      .from('reservas')
      .insert({
        sala_id: reserva.sala_id ?? 'sala-juntas',
        nombre: reserva.nombre,
        departamento: reserva.departamento,
        motivo: reserva.motivo ?? null,
        fecha_inicio: reserva.fecha_inicio,
        fecha_fin: reserva.fecha_fin,
        estado: reserva.estado ?? 'reservado',
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async cancelarReserva(id: string): Promise<ReservaSala> {
    const { data, error } = await this.client
      .from('reservas')
      .update({ estado: 'cancelado' })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  async validarChoqueHorario(nuevaInicio: string | Date, nuevaFin: string | Date): Promise<boolean> {
    const inicioConMargen = this.agregarMinutos(nuevaInicio, -this.minutosSeparacionEntreReservas);
    const finConMargen = this.agregarMinutos(nuevaFin, this.minutosSeparacionEntreReservas);

    const { data, error } = await this.client
      .from('reservas')
      .select('id')
      .eq('estado', 'reservado')
      .lt('fecha_inicio', finConMargen)
      .gt('fecha_fin', inicioConMargen)
      .limit(1);

    if (error) {
      throw error;
    }

    return Boolean(data?.length);
  }

  escucharCambiosReservas(callback: () => void): () => void {
    this.realtimeChannel?.unsubscribe();

    this.realtimeChannel = this.client
      .channel('reservas-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reservas',
        },
        () => callback(),
      )
      .subscribe();

    return () => {
      this.realtimeChannel?.unsubscribe();
      this.realtimeChannel = null;
    };
  }

  private get client(): SupabaseClient {
    if (!this.supabase) {
      if (!this.supabaseEstaConfigurado()) {
        throw new Error('Configura supabaseUrl y supabaseAnonKey en environments antes de conectar.');
      }

      this.supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);
    }

    return this.supabase;
  }

  private supabaseEstaConfigurado(): boolean {
    return (
      Boolean(environment.supabaseUrl) &&
      Boolean(environment.supabaseAnonKey) &&
      environment.supabaseUrl !== 'TU_SUPABASE_URL' &&
      environment.supabaseAnonKey !== 'TU_SUPABASE_ANON_KEY'
    );
  }

  private toIsoString(value: string | Date): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  }

  private agregarMinutos(value: string | Date, minutes: number): string {
    const date = value instanceof Date ? new Date(value) : new Date(value);
    date.setMinutes(date.getMinutes() + minutes);
    return date.toISOString();
  }
}
