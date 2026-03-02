import { Prop } from "@nestjs/mongoose";
import { ArticleCategory } from "src/schemas/article.schema";

export class CreateArticleDto {

  @Prop({message:"Article Title Must be String"})
  title:string

  @Prop({message:"Publish date Is Required"})
  publishDate:string

  @Prop({message:"Blog Details is Required"})
  blogDetails:string

  @Prop({message:"Image is Required"})
  image:string

  @Prop({message:"Category is Required", enum:ArticleCategory})
  category:ArticleCategory

}
