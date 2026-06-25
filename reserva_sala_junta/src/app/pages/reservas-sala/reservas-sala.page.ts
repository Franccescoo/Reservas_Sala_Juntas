import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { FullCalendarModule } from '@fullcalendar/angular';
import { CalendarOptions, DateSelectArg, EventClickArg } from '@fullcalendar/core';
import esLocale from '@fullcalendar/core/locales/es';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import timeGridPlugin from '@fullcalendar/timegrid';
import { addIcons } from 'ionicons';
import { calendarOutline } from 'ionicons/icons';
import {
  AlertController,
  IonButton,
  IonContent,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonTextarea,
  ToastController,
} from '@ionic/angular/standalone';

import { ReservaSala, ReservasService } from '../../services/reservas.service';
import packageInfo from '../../../../package.json';

@Component({
  selector: 'app-reservas-sala',
  templateUrl: './reservas-sala.page.html',
  styleUrls: ['./reservas-sala.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FullCalendarModule,
    IonButton,
    IonContent,
    IonIcon,
    IonInput,
    IonItem,
    IonLabel,
    IonTextarea,
  ],
})
export class ReservasSalaPage implements OnInit, OnDestroy {
  @ViewChild('formularioReserva') private formularioReserva?: ElementRef<HTMLElement>;

  private readonly fb = inject(FormBuilder);
  private readonly reservasService = inject(ReservasService);
  private readonly toastController = inject(ToastController);
  private readonly alertController = inject(AlertController);

  reservas: ReservaSala[] = [];
  reservaSeleccionada: ReservaSala | null = null;
  guardando = false;
  cargando = true;
  mensajeConexion = '';
  sincronizando = false;
  ultimaActualizacion: Date | null = null;
  readonly appVersion = `V${packageInfo.version}`;

  readonly reservaForm = this.fb.nonNullable.group(
    {
      nombre: ['', Validators.required],
      departamento: ['', Validators.required],
      motivo: [''],
      fecha: ['', Validators.required],
      horaInicio: ['', Validators.required],
      horaFin: ['', Validators.required],
    },
    {
      validators: [this.validarHoraFinMayor],
    },
  );

  calendarOptions: CalendarOptions = {
    plugins: [dayGridPlugin, timeGridPlugin, interactionPlugin],
    initialView: 'timeGridWeek',
    locale: esLocale,
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay',
    },
    buttonText: {
      today: 'Hoy',
      month: 'Mes',
      week: 'Semana',
      day: 'Dia',
    },
    allDaySlot: false,
    editable: false,
    events: [],
    eventClick: (event: EventClickArg) => this.seleccionarReserva(event),
    eventTimeFormat: {
      hour: '2-digit',
      minute: '2-digit',
      meridiem: false,
    },
    contentHeight: 520,
    expandRows: true,
    height: 'auto',
    nowIndicator: true,
    selectable: true,
    select: (selection: DateSelectArg) => this.prepararReservaDesdeCalendario(selection),
    slotDuration: '01:00:00',
    slotLabelFormat: {
      hour: '2-digit',
      minute: '2-digit',
      meridiem: false,
    },
    slotMinTime: '07:00:00',
    slotMaxTime: '18:00:00',
  };

  private realtimeChannel: RealtimeChannel | null = null;

  constructor() {
    addIcons({ calendarOutline });
  }

  async ngOnInit(): Promise<void> {
    await this.cargarReservas();

    try {
      this.realtimeChannel = this.reservasService.escucharCambiosReservas(() => {
        void this.onCambioReservasRealtime();
      });
    } catch (error) {
      this.manejarError(error, false);
    }
  }

  ngOnDestroy(): void {
    this.realtimeChannel?.unsubscribe();
    this.realtimeChannel = null;
  }

  enfocarFormulario(limpiar = false): void {
    if (limpiar) {
      this.limpiarFormulario();
    }

    requestAnimationFrame(() => {
      this.formularioReserva?.nativeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });

      const input = this.formularioReserva?.nativeElement.querySelector('ion-input');
      void input?.setFocus();
    });
  }

  limpiarFormulario(): void {
    this.reservaSeleccionada = null;
    this.guardando = false;
    this.reservaForm.reset();
  }

  async guardarReserva(): Promise<void> {
    this.reservaForm.markAllAsTouched();

    if (this.reservaForm.invalid) {
      await this.mostrarToast('Revisa los campos requeridos y el rango horario.', 'warning');
      return;
    }

    const fechas = this.obtenerFechasFormulario();

    if (!fechas) {
      await this.mostrarToast('No fue posible interpretar la fecha seleccionada.', 'danger');
      return;
    }

    this.guardando = true;

    try {
      const hayChoque = await this.reservasService.validarChoqueHorario(fechas.inicio, fechas.fin);

      if (hayChoque) {
        await this.mostrarToast('Debe existir un margen de 20 minutos entre reservas.', 'danger');
        return;
      }

      const formValue = this.reservaForm.getRawValue();

      await this.reservasService.crearReserva({
        sala_id: 'sala-juntas',
        nombre: formValue.nombre.trim(),
        departamento: formValue.departamento.trim(),
        motivo: formValue.motivo?.trim() || null,
        fecha_inicio: fechas.inicio.toISOString(),
        fecha_fin: fechas.fin.toISOString(),
        estado: 'reservado',
      });

      await this.cargarReservas(false);
      this.limpiarFormulario();
      await this.mostrarToast('Reserva creada correctamente.', 'success');
    } catch (error) {
      this.manejarError(error);
    } finally {
      this.guardando = false;
    }
  }

  async confirmarCancelacion(reserva: ReservaSala): Promise<void> {
    if (!reserva.id) {
      return;
    }

    const alerta = await this.alertController.create({
      header: 'Cancelar reserva',
      message: 'La reserva quedara marcada como cancelada y no se eliminara.',
      buttons: [
        {
          text: 'Volver',
          role: 'cancel',
        },
        {
          text: 'Cancelar reserva',
          role: 'destructive',
          handler: () => {
            void this.cancelarReserva(reserva);
          },
        },
      ],
    });

    await alerta.present();
  }

  fechaCorta(fecha?: string): string {
    if (!fecha) {
      return '--';
    }

    return new Intl.DateTimeFormat('es-CL', {
      day: '2-digit',
      month: 'short',
    }).format(new Date(fecha));
  }

  horaCorta(fecha?: string): string {
    if (!fecha) {
      return '--:--';
    }

    return new Intl.DateTimeFormat('es-CL', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(fecha));
  }

  get reservasHoy(): number {
    const hoy = new Date().toDateString();
    return this.reservas.filter((reserva) => new Date(reserva.fecha_inicio).toDateString() === hoy).length;
  }

  get proximaReserva(): ReservaSala | null {
    return this.proximasReservas[0] ?? null;
  }

  get proximasReservas(): ReservaSala[] {
    const ahora = Date.now();

    return this.reservas
      .filter((reserva) => new Date(reserva.fecha_inicio).getTime() >= ahora)
      .sort((a, b) => new Date(a.fecha_inicio).getTime() - new Date(b.fecha_inicio).getTime())
      .slice(0, 5);
  }

  private async cargarReservas(mostrarCarga = true): Promise<void> {
    if (mostrarCarga) {
      this.cargando = true;
    }

    try {
      this.mensajeConexion = '';
      this.reservas = await this.reservasService.obtenerReservas();
      this.calendarOptions = {
        ...this.calendarOptions,
        events: this.reservas.map((reserva) => ({
          id: reserva.id,
          title: `${reserva.nombre} - ${reserva.departamento}`,
          start: reserva.fecha_inicio,
          end: reserva.fecha_fin,
          backgroundColor: '#16a34a',
          borderColor: '#22c55e',
          textColor: '#ecfdf5',
          extendedProps: {
            reserva,
          },
        })),
      };

      if (this.reservaSeleccionada?.id) {
        this.reservaSeleccionada =
          this.reservas.find((reserva) => reserva.id === this.reservaSeleccionada?.id) ?? null;
      }
    } catch (error) {
      this.manejarError(error, false);
    } finally {
      this.cargando = false;
    }
  }

  private seleccionarReserva({ event }: EventClickArg): void {
    this.reservaSeleccionada = event.extendedProps['reserva'] as ReservaSala;
  }

  private prepararReservaDesdeCalendario(selection: DateSelectArg): void {
    this.reservaSeleccionada = null;
    this.reservaForm.patchValue({
      fecha: this.formatearFechaInput(selection.start),
      horaInicio: this.formatearHoraInput(selection.start),
      horaFin: this.formatearHoraInput(selection.end),
    });
    this.enfocarFormulario();
  }

  private async cancelarReserva(reserva: ReservaSala): Promise<void> {
    if (!reserva.id) {
      return;
    }

    try {
      await this.reservasService.cancelarReserva(reserva.id);
      this.reservaSeleccionada = null;
      await this.cargarReservas(false);
      await this.mostrarToast('Reserva cancelada correctamente.', 'success');
    } catch (error) {
      this.manejarError(error);
    }
  }

  private obtenerFechasFormulario(): { inicio: Date; fin: Date } | null {
    const { fecha, horaInicio, horaFin } = this.reservaForm.getRawValue();

    if (!fecha || !horaInicio || !horaFin) {
      return null;
    }

    const inicio = new Date(`${fecha}T${horaInicio}:00`);
    const fin = new Date(`${fecha}T${horaFin}:00`);

    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
      return null;
    }

    return { inicio, fin };
  }

  private validarHoraFinMayor(control: AbstractControl): ValidationErrors | null {
    const horaInicio = control.get('horaInicio')?.value;
    const horaFin = control.get('horaFin')?.value;

    if (!horaInicio || !horaFin) {
      return null;
    }

    return horaFin > horaInicio ? null : { horaFinInvalida: true };
  }

  private formatearFechaInput(fecha: Date): string {
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(
      fecha.getDate(),
    ).padStart(2, '0')}`;
  }

  private formatearHoraInput(fecha: Date): string {
    return `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`;
  }

  private async mostrarToast(
    mensaje: string,
    color: 'success' | 'warning' | 'danger' = 'success',
  ): Promise<void> {
    const toast = await this.toastController.create({
      message: mensaje,
      color,
      duration: color === 'success' ? 2000 : 2800,
      position: 'top',
    });

    await toast.present();
  }

  private async onCambioReservasRealtime(): Promise<void> {
    this.sincronizando = true;

    try {
      await this.cargarReservas(false);
      this.ultimaActualizacion = new Date();
      await this.mostrarToast('Calendario actualizado en tiempo real');
    } finally {
      this.sincronizando = false;
    }
  }

  private manejarError(error: unknown, mostrarToast = true): void {
    const mensaje = error instanceof Error ? error.message : 'Ocurrio un error inesperado.';
    this.mensajeConexion = mensaje;

    if (mostrarToast) {
      void this.mostrarToast(mensaje, 'danger');
    }
  }
}
