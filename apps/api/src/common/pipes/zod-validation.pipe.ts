import { BadRequestException, Injectable } from '@nestjs/common';
import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import { isZodDto } from '../zod-dto.js';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const { metatype } = metadata;

    if (!isZodDto(metatype)) {
      return value;
    }

    const result = metatype.zodSchema.safeParse(value);

    if (!result.success) {
      const details = result.error.issues.map((issue) => {
        const field = issue.path.join('.');
        return field.length > 0 ? `${field}: ${issue.message}` : issue.message;
      });

      throw new BadRequestException(details.join('; '));
    }

    return result.data;
  }
}
