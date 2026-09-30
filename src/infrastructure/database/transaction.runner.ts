import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/** Lets services group repository writes atomically without touching TypeORM. */
@Injectable()
export class TransactionRunner {
  constructor(private readonly dataSource: DataSource) {}

  run<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  async ping(): Promise<boolean> {
    await this.dataSource.query('SELECT 1');
    return true;
  }
}
